import { TableAggregate } from "@convex-dev/aggregate";
import { components } from "./_generated/api";
import { internalMutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { DataModel, Id } from "./_generated/dataModel";
import { requireNeedOwner } from "./model/auth";

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
    await requireNeedOwner(ctx, args.needId);
    const [offerCount, totalQty] = await Promise.all([
      offersByNeed.count(ctx, { namespace: args.needId }),
      offersByNeed.sum(ctx, { namespace: args.needId }),
    ]);
    return { offerCount, totalQty };
  },
});

// Paginated and idempotent so existing deployments can be migrated without a
// full-table transaction. Continue until isDone is true.
export const backfillOfferTotalsPage = internalMutation({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({ inserted: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query("offers").paginate(args.paginationOpts);
    for (const offer of page.page) {
      await offersByNeed.insertIfDoesNotExist(ctx, offer);
    }
    return { inserted: page.page.length, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});
