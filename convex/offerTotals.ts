import { TableAggregate } from "@convex-dev/aggregate";
import { components } from "./_generated/api";
import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { DataModel, Id } from "./_generated/dataModel";

// Live quoted totals per need: offer count and summed quantity, maintained
// transactionally on every offer write. Powers instant coverage stats at any
// scale without scanning the offers table.
export const offersByNeed = new TableAggregate<{
  Namespace: Id<"needs">;
  Key: number;
  DataModel: DataModel;
  TableName: "offers";
}>(components.aggregate, {
  namespace: (doc) => doc.needId,
  sortKey: (doc) => doc._creationTime,
  sumValue: (doc) => doc.qty,
});

export const getNeedCoverage = query({
  args: { needId: v.id("needs") },
  returns: v.object({ offerCount: v.number(), totalQty: v.number() }),
  handler: async (ctx, args) => {
    const [offerCount, totalQty] = await Promise.all([
      offersByNeed.count(ctx, { namespace: args.needId }),
      offersByNeed.sum(ctx, { namespace: args.needId }),
    ]);
    return { offerCount, totalQty };
  },
});

// One-shot backfill for deployments that predate the aggregate. Run once via
// CLI after deploy with { confirm: true }; it is NOT idempotent, so the
// explicit confirmation arg guards against accidental double-runs.
export const backfillOfferTotals = internalMutation({
  args: { confirm: v.boolean() },
  returns: v.object({ inserted: v.number() }),
  handler: async (ctx, args) => {
    if (!args.confirm) throw new Error("pass { confirm: true } to backfill once");
    const offers = await ctx.db.query("offers").collect();
    for (const offer of offers) {
      await offersByNeed.insert(ctx, offer);
    }
    return { inserted: offers.length };
  },
});
