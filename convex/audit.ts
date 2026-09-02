import { query } from "./_generated/server";
import { v } from "convex/values";

export const listAuditByEntity = query({
  args: { entity: v.string(), entityId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("auditEvents")
      .withIndex("by_entity", (q) => q.eq("entity", args.entity).eq("entityId", args.entityId))
      .order("desc")
      .collect();
  },
});

export const listRecentAudits = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db.query("auditEvents").withIndex("by_at").order("desc").take(args.limit ?? 50);
  },
});
