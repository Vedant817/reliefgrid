import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { requireNeedOwner } from "./model/auth";

// Idempotent inbox mapping: one row per need, first write wins.
export const ensureInbox = internalMutation({
  args: {
    needId: v.id("needs"),
    inboxId: v.string(),
    email: v.string(),
  },
  returns: v.id("inboxes"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("inboxes")
      .withIndex("by_need", (q) => q.eq("needId", args.needId))
      .first();
    if (existing) return existing._id;
    const inboxId = await ctx.db.insert("inboxes", {
      needId: args.needId,
      inboxId: args.inboxId,
      email: args.email,
      createdAt: Date.now(),
    });
    const claims = await ctx.db.query("inboxClaims").withIndex("by_need", (q) => q.eq("needId", args.needId)).take(2);
    for (const claim of claims) await ctx.db.delete(claim._id);
    return inboxId;
  },
});

export const claimInboxCreation = internalMutation({
  args: { needId: v.id("needs") },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireNeedOwner(ctx, args.needId);
    const existing = await ctx.db.query("inboxes").withIndex("by_need", (q) => q.eq("needId", args.needId)).first();
    if (existing) return { existing, shouldCreate: false };
    const claim = await ctx.db.query("inboxClaims").withIndex("by_need", (q) => q.eq("needId", args.needId)).first();
    const now = Date.now();
    if (claim && now - claim.claimedAt < 5 * 60 * 1000) return { existing: null, shouldCreate: false };
    if (claim) {
      await ctx.db.patch(claim._id, { claimedAt: now });
      return { existing: null, shouldCreate: true, claimedAt: now };
    }
    await ctx.db.insert("inboxClaims", { needId: args.needId, claimedAt: now });
    return { existing: null, shouldCreate: true, claimedAt: now };
  },
});

export const releaseInboxClaim = internalMutation({
  args: { needId: v.id("needs"), claimedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const claim = await ctx.db.query("inboxClaims").withIndex("by_need", (q) => q.eq("needId", args.needId)).first();
    if (claim?.claimedAt === args.claimedAt) await ctx.db.delete(claim._id);
    return null;
  },
});

export const getInboxByNeed = query({
  args: { needId: v.id("needs") },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireNeedOwner(ctx, args.needId);
    return await ctx.db
      .query("inboxes")
      .withIndex("by_need", (q) => q.eq("needId", args.needId))
      .first();
  },
});
