"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { searchViaComponent } from "../lib/firecrawl";
import { searchViaExa } from "../lib/exa";
import { WebResearchError, recordWebFailures, resolveWebResearch, withWebResearchFallback } from "../lib/webResearch";
import { recordRun } from "../lib/runs";
import { checkLimit } from "../rateLimits";
import { supplierRegionLabel } from "../lib/supplierDiscovery";

// Supplier discovery: Firecrawl searches the public web first, with Exa as a
// live fallback when Firecrawl is unavailable or out of credits. It returns
// candidates with source URLs and a public contact email when the source
// exposes one. Pure read — nothing is written until the buyer shortlists one.
export const discoverSuppliers = action({
  args: { needId: v.id("needs") },
  returns: v.object({
    suppliers: v.array(v.object({
      name: v.string(),
      url: v.string(),
      snippet: v.string(),
      contactEmail: v.optional(v.string()),
      region: v.string(),
      sourceDomain: v.string(),
      contactType: v.union(v.literal("role_mailbox"), v.literal("none")),
    })),
    providerStatus: v.literal("live"),
    provider: v.union(v.literal("firecrawl"), v.literal("exa")),
  }),
  handler: async (ctx, args) => {
    const access: any = await ctx.runQuery(internal.needs.getNeedOwnership, { needId: args.needId });
    const need = access.need;
    const ownerId: string = access.ownerId;
    await checkLimit(ctx, "discoverSuppliers", `discover:${String(args.needId)}`, ownerId);
    const startedAt = Date.now();
    const searchQuery = `official supplier distributor ${need.item} ${need.certRequired ?? ""} ${need.deliveryLocation ?? ""} sales contact email`
      .replace(/\s+/g, " ")
      .trim();
    const providers = resolveWebResearch();
    let retrieval;
    try {
      retrieval = await withWebResearchFallback({
        ...providers,
        firecrawl: () => searchViaComponent(ctx, searchQuery, 5),
        exa: () => searchViaExa(searchQuery, 5, { apiKey: providers.exaApiKey ?? undefined }),
        accept: (value) => value.hits.length > 0,
      });
    } catch (error) {
      if (error instanceof WebResearchError) {
        await recordWebFailures(ctx, error.failures, { operation: "discover_suppliers", startedAt, requestId: searchQuery, ownerId });
      }
      throw error;
    }
    await recordWebFailures(ctx, retrieval.failures, { operation: "discover_suppliers", startedAt, requestId: searchQuery, ownerId });
    const hits = retrieval.value.hits;
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
      .map((hit) => ({
        name: hit.title,
        url: hit.url,
        snippet: hit.snippet,
        contactEmail: hit.contactEmail,
        region: supplierRegionLabel(hit.url),
        sourceDomain: new URL(hit.url).hostname.toLowerCase(),
        contactType: hit.contactEmail ? "role_mailbox" as const : "none" as const,
      }));
    await recordRun(ctx, {
      provider: retrieval.provider,
      operation: "discover_suppliers",
      status: "live",
      startedAt,
      latencyMs: retrieval.value.latencyMs,
      requestId: retrieval.value.requestId,
      meta: JSON.stringify({ results: suppliers.length, fallback: retrieval.provider === "exa" }),
      ownerId,
    });
    return { suppliers, providerStatus: "live" as const, provider: retrieval.provider };
  },
});
