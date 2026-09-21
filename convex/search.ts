import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireIncidentOwner, requireOwnerKeys } from "./model/auth";

async function searchOwnedDocuments(
  ctx: QueryCtx,
  table: "incidents" | "suppliers",
  searchIndex: "search_title" | "search_name",
  searchField: "title" | "name",
  query: string,
  limit: number,
) {
  const { keys, legacyOwnerPrefix } = await requireOwnerKeys(ctx);
  const seen = new Set<string>();
  const results: any[] = [];
  for (const ownerId of keys) {
    const rows = await (ctx.db.query(table) as any)
      .withSearchIndex(searchIndex, (s: any) => s.search(searchField, query).eq("ownerId", ownerId))
      .take(limit);
    for (const row of rows) {
      if (seen.has(String(row._id))) continue;
      seen.add(String(row._id));
      results.push(row);
    }
  }
  if (legacyOwnerPrefix && results.length < limit) {
    const rows = await (ctx.db.query(table) as any)
      .withIndex("by_owner", (q: any) => q.gte("ownerId", legacyOwnerPrefix).lt("ownerId", `${legacyOwnerPrefix}\uffff`))
      .take(100);
    const needle = query.trim().toLocaleLowerCase();
    for (const row of rows) {
      if (!String(row[searchField]).toLocaleLowerCase().includes(needle) || seen.has(String(row._id))) continue;
      seen.add(String(row._id));
      results.push(row);
      if (results.length >= limit) break;
    }
  }
  return results.slice(0, limit);
}

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
    return await searchOwnedDocuments(ctx, "suppliers", "search_name", "name", args.query, Math.min(args.limit ?? 20, 50));
  },
});

export const searchIncidents = query({
  args: { query: v.string(), limit: v.optional(v.number()) },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    if (!args.query.trim()) return [];
    return await searchOwnedDocuments(ctx, "incidents", "search_title", "title", args.query, Math.min(args.limit ?? 20, 50));
  },
});
