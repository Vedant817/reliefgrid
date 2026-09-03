import { v } from "convex/values";
import { query } from "./_generated/server";
import { allocateOffers } from "./lib/allocate";

export const compareConstraints = query({
  args: {
    needId: v.id("needs"),
    deadlineExtensionHours: v.number(),
    budgetDeltaCents: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const need = await ctx.db.get(args.needId);
    if (!need) throw new Error("Need not found");
    const offers = await ctx.db.query("offers").withIndex("by_need", (q) => q.eq("needId", args.needId)).collect();
    const inputs = await Promise.all(offers.map(async (offer) => ({
      offerId: String(offer._id),
      supplierId: String(offer.supplierId),
      supplierName: (await ctx.db.get(offer.supplierId))?.name ?? "Unknown supplier",
      qty: offer.qty,
      unitPriceCents: offer.unitPriceCents,
      arrivalAt: offer.arrivalAt,
      certStatus: offer.certStatus,
      confidence: offer.confidence,
      fieldEvidence: offer.fieldEvidence,
    })));
    const baseline = allocateOffers(inputs, need);
    const hypothetical = allocateOffers(inputs, {
      ...need,
      deadlineAt: need.deadlineAt + args.deadlineExtensionHours * 3600000,
      budgetCents: need.budgetCents + (args.budgetDeltaCents ?? 0),
    });
    const savingsCents = baseline.totalCostCents - hypothetical.totalCostCents;
    return {
      baseline,
      hypothetical,
      savingsCents,
      override: {
        deadlineExtensionHours: args.deadlineExtensionHours,
        budgetDeltaCents: args.budgetDeltaCents ?? 0,
      },
      sideEffectFree: true,
    };
  },
});
