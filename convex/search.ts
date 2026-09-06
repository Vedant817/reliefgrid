import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireIncidentOwner, requireOwnerId } from "./model/auth";

// Full-text search for coordinator triage. Backed by schema search indexes,
// so lookup stays indexed no matter how many incidents and suppliers exist.
export const searchNeeds = query({
  args: {
    query: v.string(),
    incidentId: v.id("incidents"),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    if (!args.query.trim()) return [];
    await requireIncidentOwner(ctx, args.incidentId);
    const q = ctx.db.query("needs").withSearchIndex("search_item", (s) => s.search("item", args.query).eq("incidentId", args.incidentId));
    return await q.take(Math.min(args.limit ?? 20, 50));
  },
});

export const searchSuppliers = query({
  args: { query: v.string(), limit: v.optional(v.number()) },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    if (!args.query.trim()) return [];
    const ownerId = await requireOwnerId(ctx);
    return await ctx.db
      .query("suppliers")
      .withSearchIndex("search_name", (s) => s.search("name", args.query).eq("ownerId", ownerId))
      .take(Math.min(args.limit ?? 20, 50));
  },
});

export const searchIncidents = query({
  args: { query: v.string(), limit: v.optional(v.number()) },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    if (!args.query.trim()) return [];
    const ownerId = await requireOwnerId(ctx);
    return await ctx.db
      .query("incidents")
      .withSearchIndex("search_title", (s) => s.search("title", args.query).eq("ownerId", ownerId))
      .take(Math.min(args.limit ?? 20, 50));
  },
});
