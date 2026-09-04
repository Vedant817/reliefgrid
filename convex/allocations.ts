import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { allocateOffers } from "./lib/allocate";

export const computeAllocation = mutation({
  args: { needId: v.id("needs") },
  handler: async (ctx, args) => {
    const need = await ctx.db.get(args.needId);
    if (!need) throw new Error("Need not found");

    const offers = await ctx.db
      .query("offers")
      .withIndex("by_need", (q) => q.eq("needId", args.needId))
      .collect();

    const enriched = await Promise.all(
      offers.map(async (o) => {
        const supplier = await ctx.db.get(o.supplierId);
        return {
          offerId: o._id,
          supplierId: o.supplierId,
          supplierName: supplier?.name ?? o.supplierId,
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

    // No offers at all: report infeasible without minting a vacuous plan.
    if (offers.length === 0) {
      return { planId: null, ...result };
    }

    const existingPlans = await ctx.db
      .query("allocationPlans")
      .withIndex("by_need", (q) => q.eq("needId", args.needId))
      .collect();

    // Idempotent recompute: identical inputs reuse the current proposed plan.
    const inputHash = JSON.stringify({
      need: { qty: need.qty, budgetCents: need.budgetCents, deadlineAt: need.deadlineAt },
      offers: enriched
        .map((o) => [o.offerId, o.qty, o.unitPriceCents, o.arrivalAt, o.certStatus, o.confidence])
        .sort(),
    });
    const identical = existingPlans.find(
      (p) => (p.status === "proposed" || p.status === "approved") && p.inputHash === inputHash,
    );
    if (identical) {
      return { planId: identical._id, ...result, deduped: true };
    }

    // Supersede previous proposed plans
    for (const p of existingPlans) {
      if (p.status === "proposed") {
        await ctx.db.patch(p._id, { status: "superseded" });
      }
    }

    const planId = await ctx.db.insert("allocationPlans", {
      needId: args.needId,
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
        reason: "selected: cheapest feasible covering",
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
    await ctx.db.patch(args.needId, {
      status: result.feasible ? "planning" : "awaiting_responses",
    });

    return { planId, ...result };
  },
});

export const listAllocationPlans = query({
  args: { needId: v.id("needs") },
  handler: async (ctx, args) => {
    const plans = await ctx.db
      .query("allocationPlans")
      .withIndex("by_need", (q) => q.eq("needId", args.needId))
      .order("desc")
      .collect();
    const enriched = await Promise.all(
      plans.map(async (p) => {
        const lines = await ctx.db
          .query("allocationLines")
          .withIndex("by_plan", (q) => q.eq("planId", p._id))
          .collect();
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

export const getLatestPlan = query({
  args: { needId: v.id("needs") },
  handler: async (ctx, args) => {
    const plans = await ctx.db
      .query("allocationPlans")
      .withIndex("by_need", (q) => q.eq("needId", args.needId))
      .order("desc")
      .collect();
    const plan = plans[0];
    if (!plan) return null;
    const lines = await ctx.db
      .query("allocationLines")
      .withIndex("by_plan", (q) => q.eq("planId", plan._id))
      .collect();
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
    approvedBy: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const plan = await ctx.db.get(args.planId);
    if (!plan) throw new Error("Plan not found");
    if (plan.status !== "proposed") throw new Error(`Only proposed plans can be approved (got ${plan.status})`);
    if (plan.totalQty <= 0) throw new Error("Cannot approve a plan covering zero units");
    // Identity is server-derived: an authenticated session always wins over
    // the client-supplied name, which survives only as a CLI fallback.
    const identity = await ctx.auth.getUserIdentity();
    const approver = (identity?.name ?? identity?.subject ?? args.approvedBy).trim();
    if (approver.length < 2) throw new Error("approvedBy must identify the approver");
    const need = await ctx.db.get(plan.needId);
    if (!need) throw new Error("Need not found");
    await ctx.db.patch(args.planId, { status: "approved" });
    const approvedAt = Date.now();
    await ctx.db.insert("approvals", {
      planId: args.planId,
      approvedBy: approver,
      approvedAt,
      notes: args.notes,
    });
    // Single-award invariant: approving this plan retires every other live plan.
    const siblings = await ctx.db
      .query("allocationPlans")
      .withIndex("by_need", (q) => q.eq("needId", plan.needId))
      .collect();
    for (const sibling of siblings) {
      if (sibling._id !== args.planId && sibling.status !== "superseded") {
        await ctx.db.patch(sibling._id, { status: "superseded" });
      }
    }
    // Update need to awarded
    await ctx.db.patch(plan.needId, { status: "awarded" });
    const approvedLines = await ctx.db
      .query("allocationLines")
      .withIndex("by_plan", (q) => q.eq("planId", args.planId))
      .collect();
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
      snapshot: JSON.stringify({
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
      .collect();
    const selectedSupplierIds = new Set(lines.map((l) => l.supplierId));
    const threads = await ctx.db
      .query("rfqThreads")
      .withIndex("by_need", (q) => q.eq("needId", plan.needId))
      .collect();
    for (const t of threads) {
      const shouldAward = selectedSupplierIds.has(t.supplierId);
      await ctx.db.patch(t._id, { status: shouldAward ? "awarded" : "rejected" });
    }
    return args.planId;
  },
});
