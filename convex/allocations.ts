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

    // Supersede previous proposed plans
    const existingPlans = await ctx.db
      .query("allocationPlans")
      .withIndex("by_need", (q) => q.eq("needId", args.needId))
      .collect();
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
        meta: JSON.stringify({ supplierId: r.supplierId, reason: r.reason }),
      });
    }

    await writeAudit(ctx, {
      entity: "allocationPlans",
      entityId: planId,
      action: "create",
      actor: "allocator",
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
        return { ...p, lines: linesWithSupplier };
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
    return { ...plan, lines: linesWithSupplier };
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
    await ctx.db.patch(args.planId, { status: "approved" });
    await ctx.db.insert("approvals", {
      planId: args.planId,
      approvedBy: args.approvedBy,
      approvedAt: Date.now(),
      notes: args.notes,
    });
    // Update need to awarded
    await ctx.db.patch(plan.needId, { status: "awarded" });
    await writeAudit(ctx, {
      entity: "allocationPlans",
      entityId: args.planId,
      action: "approved",
      actor: args.approvedBy,
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
