import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { requireNeedOwner, requireOfferOwner } from "./model/auth";
import { hasActiveRecall, resolveCertStatus } from "./lib/certStatus";

const sourceStatus = v.union(v.literal("verified"), v.literal("unverified"), v.literal("needs_review"), v.literal("failed"));

export const addSourceCheck = internalMutation({
  args: {
    offerId: v.id("offers"),
    url: v.string(),
    quote: v.string(),
    status: sourceStatus,
    reason: v.string(),
    type: v.string(),
    claim: v.optional(v.string()),
    sourceAuthority: v.optional(v.union(v.literal("authoritative"), v.literal("supporting"))),
    contentHash: v.optional(v.string()),
    matched: v.optional(v.boolean()),
  },
  returns: v.id("sourceChecks"),
  handler: async (ctx, args) => {
    const checkId = await ctx.db.insert("sourceChecks", {
      offerId: args.offerId,
      url: args.url,
      quote: args.quote,
      retrievedAt: Date.now(),
      status: args.status,
      reason: args.reason,
      type: args.type,
      claim: args.claim,
      sourceAuthority: args.sourceAuthority,
      contentHash: args.contentHash,
      matched: args.matched,
    });
    const offer = await ctx.db.get(args.offerId);
    if (offer) {
      const activeRecall = args.type === "cert" ? await hasActiveRecall(ctx, args.offerId) : false;
      const next = resolveCertStatus(
        { status: args.status, type: args.type, sourceAuthority: args.sourceAuthority, matched: args.matched },
        { activeRecall },
      );
      if (next) await ctx.db.patch(args.offerId, { certStatus: next, updatedAt: Date.now() });
    }
    return checkId;
  },
});

export const listSourceChecksByOffer = query({
  args: { offerId: v.id("offers") },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    await requireOfferOwner(ctx, args.offerId);
    return await ctx.db
      .query("sourceChecks")
      .withIndex("by_offer", (q) => q.eq("offerId", args.offerId))
      .take(200);
  },
});

export const listSourceChecksByNeed = query({
  args: { needId: v.id("needs") },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    await requireNeedOwner(ctx, args.needId);
    const offers = await ctx.db
      .query("offers")
      .withIndex("by_need", (q) => q.eq("needId", args.needId))
      .take(100);
    const all = [];
    for (const o of offers) {
      const checks = await ctx.db
        .query("sourceChecks")
        .withIndex("by_offer", (q) => q.eq("offerId", o._id))
        .take(20);
      all.push(...checks.map((c) => ({ ...c, offerId: o._id })));
    }
    return all;
  },
});
