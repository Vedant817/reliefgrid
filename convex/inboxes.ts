import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Idempotent inbox mapping: one row per need, first write wins.
export const ensureInbox = mutation({
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
    return await ctx.db.insert("inboxes", {
      needId: args.needId,
      inboxId: args.inboxId,
      email: args.email,
      createdAt: Date.now(),
    });
  },
});

export const getInboxByNeed = query({
  args: { needId: v.id("needs") },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("inboxes")
      .withIndex("by_need", (q) => q.eq("needId", args.needId))
      .first();
  },
});
