"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { resolveFirecrawl, searchViaComponent } from "../lib/firecrawl";
import { recordRun } from "../lib/runs";
import { checkLimit } from "../rateLimits";

// Supplier discovery: Firecrawl searches the public web for suppliers of the
// need's item and returns candidates with source URLs. Pure read — nothing
// is written, and adding a supplier still requires a human to supply a real
// contact email through the normal intake form.
export const discoverSuppliers = action({
  args: { needId: v.id("needs") },
  returns: v.object({
    suppliers: v.array(v.object({ name: v.string(), url: v.string(), snippet: v.string() })),
    providerStatus: v.literal("live"),
  }),
  handler: async (ctx, args) => {
    const access: any = await ctx.runQuery(internal.needs.getNeedOwnership, { needId: args.needId });
    const need = access.need;
    const ownerId: string = access.ownerId;
    await checkLimit(ctx, "discoverSuppliers", `discover:${String(args.needId)}`, ownerId);
    const firecrawl = resolveFirecrawl();
    if (!firecrawl.apiKey) throw new Error("no Firecrawl key configured (FIRECRAWL_API_KEY)");

    const startedAt = Date.now();
    const searchQuery = `suppliers ${need.item} ${need.certRequired ?? ""}`.replace(/\s+/g, " ").trim();
    let hits;
    try {
      hits = (await searchViaComponent(ctx, searchQuery, 5)).hits;
    } catch (error) {
      await recordRun(ctx, {
        provider: "firecrawl",
        operation: "discover_suppliers",
        status: "failed",
        startedAt,
        requestId: searchQuery,
        meta: JSON.stringify({ error: error instanceof Error ? error.message : "unknown" }),
        ownerId,
      });
      throw error;
    }
    const suppliers = hits
      .filter((hit) => {
        try {
          const parsed = new URL(hit.url);
          if (parsed.protocol !== "https:") return false;
          const host = parsed.hostname.toLowerCase();
          return host !== "localhost" && !host.endsWith(".local");
        } catch {
          return false;
        }
      })
      .slice(0, 5)
      .map((hit) => ({ name: hit.title, url: hit.url, snippet: hit.snippet }));
    await recordRun(ctx, {
      provider: "firecrawl",
      operation: "discover_suppliers",
      status: "live",
      startedAt,
      requestId: searchQuery,
      meta: JSON.stringify({ results: suppliers.length }),
      ownerId,
    });
    return { suppliers, providerStatus: "live" as const };
  },
});
