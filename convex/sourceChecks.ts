import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const addSourceCheck = mutation({
  args: {
    offerId: v.id("offers"),
    url: v.string(),
    quote: v.string(),
    status: v.string(),
    reason: v.string(),
    type: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("sourceChecks", {
      offerId: args.offerId,
      url: args.url,
      quote: args.quote,
      retrievedAt: Date.now(),
      status: args.status,
      reason: args.reason,
      type: args.type,
    });
  },
});

export const listSourceChecksByOffer = query({
  args: { offerId: v.id("offers") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sourceChecks")
      .withIndex("by_offer", (q) => q.eq("offerId", args.offerId))
      .collect();
  },
});

export const listSourceChecksByNeed = query({
  args: { needId: v.id("needs") },
  handler: async (ctx, args) => {
    const offers = await ctx.db
      .query("offers")
      .withIndex("by_need", (q) => q.eq("needId", args.needId))
      .collect();
    const all = [];
    for (const o of offers) {
      const checks = await ctx.db
        .query("sourceChecks")
        .withIndex("by_offer", (q) => q.eq("offerId", o._id))
        .collect();
      all.push(...checks.map((c) => ({ ...c, offerId: o._id })));
    }
    return all;
  },
});
