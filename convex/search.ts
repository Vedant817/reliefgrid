import { v } from "convex/values";
import { query } from "./_generated/server";

// Full-text search for coordinator triage. Backed by schema search indexes,
// so lookup stays indexed no matter how many incidents and suppliers exist.
export const searchNeeds = query({
  args: {
    query: v.string(),
    incidentId: v.optional(v.id("incidents")),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    if (!args.query.trim()) return [];
    let q = ctx.db.query("needs").withSearchIndex("search_item", (s) => {
      const expr = s.search("item", args.query);
      return args.incidentId ? expr.eq("incidentId", args.incidentId) : expr;
    });
    return await q.take(Math.min(args.limit ?? 20, 50));
  },
});

export const searchSuppliers = query({
  args: { query: v.string(), limit: v.optional(v.number()) },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    if (!args.query.trim()) return [];
    return await ctx.db
      .query("suppliers")
      .withSearchIndex("search_name", (s) => s.search("name", args.query))
      .take(Math.min(args.limit ?? 20, 50));
  },
});

export const searchIncidents = query({
  args: { query: v.string(), limit: v.optional(v.number()) },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    if (!args.query.trim()) return [];
    return await ctx.db
      .query("incidents")
      .withSearchIndex("search_title", (s) => s.search("title", args.query))
      .take(Math.min(args.limit ?? 20, 50));
  },
});
