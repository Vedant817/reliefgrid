"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { api } from "../_generated/api";
import { resolveFirecrawl, scrapeViaComponent } from "../lib/firecrawl";
import { checkLimit } from "../rateLimits";

// Live-only Firecrawl verification. There is no mock lane: missing keys or
// provider errors throw after recording a failed run, so verification state
// is never silently fabricated.
export const verifyOffer = action({
  args: {
    offerId: v.id("offers"),
    type: v.string(), // cert, recall, spec
    url: v.string(),
  },
  handler: async (ctx, args): Promise<any> => {
    await checkLimit(ctx, "verifySource", String(args.offerId));
    const startedAt = Date.now();
    const firecrawl = resolveFirecrawl();
    if (!firecrawl.apiKey) throw new Error("no Firecrawl key configured (FIRECRAWL_API_KEY)");

    let scraped;
    try {
      scraped = await scrapeViaComponent(ctx, args.url);
    } catch (e) {
      await ctx.runMutation(api.health.recordProviderRun, {
        provider: "firecrawl",
        operation: `verify_${args.type}`,
        status: "failed",
        latencyMs: Date.now() - startedAt,
        requestId: String(args.offerId),
        meta: JSON.stringify({ error: e instanceof Error ? e.message : "unknown", url: args.url }),
      });
      throw e;
    }

    const quote = `${scraped.title} — ${scraped.quote}`;
    await ctx.runMutation(api.sourceChecks.addSourceCheck, {
      offerId: args.offerId,
      url: args.url,
      quote,
      status: "verified",
      reason: `Live Firecrawl scrape of ${args.url}`,
      type: args.type,
    });
    await ctx.runMutation(api.health.recordProviderRun, {
      provider: "firecrawl",
      operation: `verify_${args.type}`,
      status: "live",
      latencyMs: scraped.latencyMs,
      requestId: scraped.requestId,
    });

    return { ok: true, quote, url: args.url, providerStatus: "live" };
  },
});
