import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { buildDriftSnapshot } from "./lib/drift";
import { allocateOffers } from "./lib/allocate";
import { requireIncidentOwner, requireNeedOwner, requirePlanOwner, requireSupplierOwner } from "./model/auth";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { allocationInputHash } from "./lib/allocationHash";

async function computeAllocationImpl(ctx: MutationCtx, args: { needId: Id<"needs"> }) {
  return await recomputeAllocation(ctx, args.needId, {
    supersedeApproved: false,
    allowEmpty: false,
    lineReason: "selected: cheapest feasible covering",
  });
}

// The single transactional recompute behind every path that (re)plans a
// need: user recompute, extraction, verification, evidence drift, and guided
// recovery. One canonical enrichment shape feeds both the allocator and the
// input hash, so any plan it mints carries a hash the approval freshness
// check can verify — drift-minted plans used to hash without field evidence
// and die as stale at approval time.
export async function recomputeAllocation(
  ctx: MutationCtx,
  needId: Id<"needs">,
  opts: { supersedeApproved: boolean; allowEmpty: boolean; lineReason: string },
) {
  const need = await ctx.db.get(needId);
  if (!need) throw new Error("Need not found");

  const offers = await ctx.db
    .query("offers")
    .withIndex("by_need", (q) => q.eq("needId", needId))
    .take(201);
  if (offers.length > 200) throw new Error("This need exceeds the 200-offer allocation limit");

  const enriched = await Promise.all(
    offers.map(async (o) => {
      const supplier = await ctx.db.get(o.supplierId);
      return {
        offerId: o._id,
        supplierId: o.supplierId,
        supplierName: supplier?.name ?? "Unknown supplier",
        qty: o.qty,
        unitPriceCents: o.unitPriceCents,
        arrivalAt: o.arrivalAt,
        certStatus: o.certStatus,
        confidence: o.confidence,
        fieldEvidence: o.fieldEvidence,
      };
    }),
  );

  const result = allocateOffers(enriched, {
    qty: need.qty,
    budgetCents: need.budgetCents,
    deadlineAt: need.deadlineAt,
    certRequired: need.certRequired,
    partialAllowed: need.partialAllowed,
  });

  // No offers at all: report infeasible without minting a vacuous plan,
  // unless the caller is a drift path that must always leave a fresh plan.
  if (offers.length === 0 && !opts.allowEmpty) {
    return { planId: null, ...result };
  }

  const existingPlans = await ctx.db
    .query("allocationPlans")
    .withIndex("by_need", (q) => q.eq("needId", needId))
    .take(101);

  // Idempotent recompute: identical inputs reuse the current live plan.
  const inputHash = allocationInputHash(need, enriched);
  const identical = existingPlans.find(
    (p) => (p.status === "proposed" || p.status === "approved") && p.inputHash === inputHash,
  );
  if (identical) {
    return { planId: identical._id, ...result, deduped: true };
  }
  if (existingPlans.length >= 100) throw new Error("This need has reached the 100-plan history limit");

  // Supersede previous proposed plans; drift paths additionally dethrone an
  // approved plan the new evidence invalidates.
  for (const p of existingPlans) {
    if (p.status === "proposed" || (opts.supersedeApproved && p.status === "approved")) {
      await ctx.db.patch(p._id, { status: "superseded" });
    }
  }

  const planId = await ctx.db.insert("allocationPlans", {
    needId,
    status: "proposed",
    totalCostCents: result.totalCostCents,
    totalQty: result.totalQty,
    createdAt: Date.now(),
    decisionTrace: result.trace,
    inputHash,
  });

  for (const s of result.selected) {
    await ctx.db.insert("allocationLines", {
      planId,
      supplierId: s.supplierId as any,
      offerId: s.offerId as any,
      qty: s.qty,
      costCents: s.qty * s.unitPriceCents,
      reason: opts.lineReason,
    });
  }
  // Record rejected as audit for traceability
  for (const r of result.rejected) {
    await writeAudit(ctx, {
      entity: "allocationPlans",
      entityId: planId,
      action: "rejected_offer",
      actor: "allocator",
      incidentId: need.incidentId,
      meta: JSON.stringify({ supplierId: r.supplierId, reason: r.reason }),
    });
  }

  await writeAudit(ctx, {
    entity: "allocationPlans",
    entityId: planId,
    action: "create",
    actor: "allocator",
    incidentId: need.incidentId,
    meta: JSON.stringify({ totalQty: result.totalQty, feasible: result.feasible }),
  });

  // Update need status
  await ctx.db.patch(needId, {
    status: result.feasible ? "planning" : "awaiting_responses",
  });

  return { planId, ...result };
}

export const computeAllocation = mutation({
  args: { needId: v.id("needs") },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireNeedOwner(ctx, args.needId);
    return await computeAllocationImpl(ctx, args);
  },
});

export const computeAllocationInternal = internalMutation({
  args: { needId: v.id("needs") },
  returns: v.any(),
  handler: computeAllocationImpl,
});

export const listAllocationPlans = query({
  args: { needId: v.id("needs") },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    await requireNeedOwner(ctx, args.needId);
    const plans = await ctx.db
      .query("allocationPlans")
      .withIndex("by_need", (q) => q.eq("needId", args.needId))
      .order("desc")
      .take(20);
    const enriched = await Promise.all(
      plans.map(async (p) => {
        const lines = await ctx.db
          .query("allocationLines")
          .withIndex("by_plan", (q) => q.eq("planId", p._id))
          .take(200);
        const linesWithSupplier = await Promise.all(
          lines.map(async (l) => {
            const supplier = await ctx.db.get(l.supplierId);
            const offer = await ctx.db.get(l.offerId);
            return { ...l, supplier, offer };
          }),
        );
        const approval = await ctx.db
          .query("approvals")
          .withIndex("by_plan", (q) => q.eq("planId", p._id))
          .first();
        return { ...p, lines: linesWithSupplier, approval: approval ?? null };
      }),
    );
    return enriched;
  },
});
// Basket view: the latest plan totals for every need in an incident, so a
// multi-item request can be summarized as "x of y items covered".
export const listPlansByIncident = query({
  args: { incidentId: v.id("incidents") },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireIncidentOwner(ctx, args.incidentId);
    const needs = await ctx.db
      .query("needs")
      .withIndex("by_incident", (q) => q.eq("incidentId", args.incidentId))
      .take(100);
    return await Promise.all(
      needs.map(async (need) => {
        const plan = await ctx.db
          .query("allocationPlans")
          .withIndex("by_need", (q) => q.eq("needId", need._id))
          .order("desc")
          .first();
        return {
          needId: need._id,
          item: need.item,
          qty: need.qty,
          budgetCents: need.budgetCents,
          totalQty: plan?.totalQty ?? 0,
          totalCostCents: plan?.totalCostCents ?? 0,
          status: plan?.status ?? "none",
        };
      }),
    );
  },
});

export const getLatestPlan = query({
  args: { needId: v.id("needs") },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireNeedOwner(ctx, args.needId);
    const plan = await ctx.db
      .query("allocationPlans")
      .withIndex("by_need", (q) => q.eq("needId", args.needId))
      .order("desc")
      .first();
    if (!plan) return null;
    const lines = await ctx.db
      .query("allocationLines")
      .withIndex("by_plan", (q) => q.eq("planId", plan._id))
      .take(200);
    const linesWithSupplier = await Promise.all(
      lines.map(async (l) => {
        const supplier = await ctx.db.get(l.supplierId);
        return { ...l, supplier };
      }),
    );
    const approval = await ctx.db
      .query("approvals")
      .withIndex("by_plan", (q) => q.eq("planId", plan._id))
      .first();
    return { ...plan, lines: linesWithSupplier, approval: approval ?? null };
  },
});

export const approvePlan = mutation({
  args: {
    planId: v.id("allocationPlans"),
    notes: v.optional(v.string()),
  },
  returns: v.id("allocationPlans"),
  handler: async (ctx, args) => {
    const { plan } = await requirePlanOwner(ctx, args.planId);
    if (plan.status !== "proposed") throw new Error(`Only proposed plans can be approved (got ${plan.status})`);
    if (plan.totalQty <= 0) throw new Error("Cannot approve a plan covering zero units");
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");
    const approver = (identity.name ?? identity.tokenIdentifier).trim();
    if (approver.length < 2) throw new Error("approvedBy must identify the approver");
    const need = await ctx.db.get(plan.needId);
    if (!need) throw new Error("Need not found");
    const currentOffers = await ctx.db.query("offers").withIndex("by_need", (q) => q.eq("needId", plan.needId)).take(201);
    if (currentOffers.length > 200) throw new Error("This need exceeds the 200-offer approval limit");
    const enriched = await Promise.all(currentOffers.map(async (offer) => {
      const { supplier } = await requireSupplierOwner(ctx, offer.supplierId, "Plan references an unavailable supplier");
      return {
        offerId: offer._id,
        supplierId: offer.supplierId,
        supplierName: supplier.name,
        qty: offer.qty,
        unitPriceCents: offer.unitPriceCents,
        arrivalAt: offer.arrivalAt,
        certStatus: offer.certStatus,
        confidence: offer.confidence,
        fieldEvidence: offer.fieldEvidence,
      };
    }));
    const current = allocateOffers(enriched, need);
    if (plan.inputHash !== allocationInputHash(need, enriched)) throw new Error("Plan is stale; recompute before approval");
    if (!current.feasible || current.totalQty < need.qty) throw new Error(`Cannot award an incomplete plan (${current.totalQty}/${need.qty} units)`);
    if (current.totalQty !== plan.totalQty || current.totalCostCents !== plan.totalCostCents) throw new Error("Plan totals no longer match current offers");
    const approvedLines = await ctx.db.query("allocationLines").withIndex("by_plan", (q) => q.eq("planId", args.planId)).take(201);
    if (approvedLines.length > 200) throw new Error("Plan exceeds the 200-line approval limit");
    const expected = current.selected.map((offer) => `${offer.offerId}:${offer.qty}:${offer.qty * offer.unitPriceCents}`).sort();
    const actual = approvedLines.map((line) => `${line.offerId}:${line.qty}:${line.costCents}`).sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error("Plan lines no longer match current offers");
    await ctx.db.patch(args.planId, { status: "approved" });
    const approvedAt = Date.now();
    // Single-award invariant: approving this plan retires every other live plan.
    const siblings = await ctx.db
      .query("allocationPlans")
      .withIndex("by_need", (q) => q.eq("needId", plan.needId))
      .take(100);
    const replacedPlanIds = [];
    for (const sibling of siblings) {
      if (sibling._id !== args.planId && sibling.status !== "superseded") {
        await ctx.db.patch(sibling._id, { status: "superseded" });
        replacedPlanIds.push(sibling._id);
      }
    }
    await ctx.db.insert("approvals", {
      planId: args.planId,
      approvedBy: approver,
      approvedAt,
      notes: args.notes,
      replacedPlanIds,
    });
    // Update need to awarded
    await ctx.db.patch(plan.needId, { status: "awarded" });
    const approvedOffers = await Promise.all(
      approvedLines.map(async (line) => {
        const supplier = await ctx.db.get(line.supplierId);
        const offer = await ctx.db.get(line.offerId);
        return {
          supplier: supplier?.name ?? "Unknown supplier",
          qty: line.qty,
          certStatus: offer?.certStatus ?? "unknown",
        };
      }),
    );
    const approvedSuppliers = [...new Set(approvedOffers.map((o) => o.supplier))];
    await writeAudit(ctx, {
      entity: "allocationPlans",
      entityId: args.planId,
      action: "approved",
      actor: approver,
      incidentId: need.incidentId,
      snapshot: buildDriftSnapshot({
        incident: { id: String(need.incidentId) },
        need: { id: String(plan.needId), item: need.item, qty: need.qty },
        offers: approvedOffers,
        plan: { id: String(args.planId), coverage: plan.totalQty, costCents: plan.totalCostCents, suppliers: approvedSuppliers },
        approvedBy: approver,
        approvedAt,
        causalDiff: `Plan approved by ${approver}; coverage ${plan.totalQty}/${need.qty}`,
      }),
      meta: args.notes,
    });
    // Update threads to awarded/rejected
    const lines = await ctx.db
      .query("allocationLines")
      .withIndex("by_plan", (q) => q.eq("planId", args.planId))
      .take(200);
    const selectedSupplierIds = new Set(lines.map((l) => l.supplierId));
    const threads = await ctx.db
      .query("rfqThreads")
      .withIndex("by_need", (q) => q.eq("needId", plan.needId))
      .take(100);
    for (const t of threads) {
      const shouldAward = selectedSupplierIds.has(t.supplierId);
      await ctx.db.patch(t._id, { status: shouldAward ? "awarded" : "rejected" });
    }
    await ctx.scheduler.runAfter(0, internal.actions.awards.sendAwardNotices, { planId: args.planId });
    return args.planId;
  },
});
