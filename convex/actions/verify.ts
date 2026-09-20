"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { api, internal } from "../_generated/api";
import { scrapeViaComponent } from "../lib/firecrawl";
import { scrapeViaExa } from "../lib/exa";
import { WebResearchError, recordWebFailures, resolveWebResearch, withWebResearchFallback } from "../lib/webResearch";
import {
  RECALL_LANGUAGE,
  authorityForHostname,
  containsExactPhrase,
  normalized,
  sha256Hex,
} from "../lib/evidence";
import { checkLimit } from "../rateLimits";
import { recordRun } from "../lib/runs";

// Live web verification prefers Firecrawl and falls back to Exa. Both paths
// feed the same strict evidence matcher; provider output alone never changes
// eligibility without authoritative-domain and exact-claim matches.
export const verifyOffer = action({
  args: {
    offerId: v.id("offers"),
    type: v.union(v.literal("cert"), v.literal("recall"), v.literal("spec")),
    url: v.string(),
  },
  returns: v.object({
    ok: v.boolean(),
    quote: v.string(),
    url: v.string(),
    status: v.union(v.literal("verified"), v.literal("failed"), v.literal("needs_review")),
    authority: v.union(v.literal("authoritative"), v.literal("supporting")),
    claimMatched: v.boolean(),
    providerStatus: v.literal("live"),
  }),
  handler: async (ctx, args): Promise<any> => {
    const offer: any = await ctx.runQuery(api.offers.getOfferForVerification, { offerId: args.offerId });
    if (args.url.length > 2000) throw new Error("Verification URL is too long");
    const parsedUrl = new URL(args.url);
    if (parsedUrl.protocol !== "https:") throw new Error("Verification sources must use HTTPS");
    const host = parsedUrl.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local")) {
      throw new Error("Private verification sources are not allowed");
    }
    await checkLimit(ctx, "verifySource", String(args.offerId), offer.ownerId);
    const startedAt = Date.now();
    const providers = resolveWebResearch();
    let retrieval;
    try {
      retrieval = await withWebResearchFallback({
        ...providers,
        firecrawl: () => scrapeViaComponent(ctx, args.url),
        exa: () => scrapeViaExa(args.url, { apiKey: providers.exaApiKey ?? undefined }),
      });
    } catch (e) {
      if (e instanceof WebResearchError) {
        await recordWebFailures(ctx, e.failures, {
          operation: `verify_${args.type}`,
          startedAt,
          requestId: String(args.offerId),
          ownerId: offer.ownerId,
        });
      }
      throw e;
    }
    await recordWebFailures(ctx, retrieval.failures, {
      operation: `verify_${args.type}`,
      startedAt,
      requestId: String(args.offerId),
      ownerId: offer.ownerId,
    });
    const scraped = retrieval.value;

    const quote = `${scraped.title} — ${scraped.quote}`;
    const authority = authorityForHostname(host);
    const body = normalized(quote);
    const claim = args.type === "cert" ? offer.need.certRequired ?? "certification" : `${args.type} status`;
    const phraseMatched = args.type === "cert"
      ? Boolean(offer.need.certRequired && body.includes(normalized(offer.need.certRequired)))
      : args.type === "recall"
        ? RECALL_LANGUAGE.test(body)
        : false;
    const productMatched = Boolean(offer.need.evidenceKey && containsExactPhrase(body, offer.need.evidenceKey));
    const claimMatched = phraseMatched && productMatched;
    const status = args.type === "recall" && authority === "authoritative" && claimMatched
      ? "failed" as const
      : authority === "authoritative" && claimMatched
        ? "verified" as const
        : "needs_review" as const;
    await ctx.runMutation(internal.sourceChecks.addSourceCheck, {
      offerId: args.offerId,
      url: args.url,
      quote,
      status,
      reason: status === "verified"
        ? `Authoritative source contains the required claim`
        : status === "failed"
          ? `Authoritative source conflicts with the offer`
          : `Source is supporting or does not contain the exact required claim`,
      type: args.type,
      claim,
      sourceAuthority: authority,
      contentHash: await sha256Hex(quote),
      matched: claimMatched,
    });
    await ctx.runMutation(internal.allocations.computeAllocationInternal, { needId: offer.needId });
    await recordRun(ctx, {
      provider: retrieval.provider,
      operation: `verify_${args.type}`,
      status: "live",
      startedAt,
      latencyMs: scraped.latencyMs,
      requestId: scraped.requestId,
      meta: JSON.stringify({ fallback: retrieval.provider === "exa", url: args.url }),
      ownerId: offer.ownerId,
    });

    return { ok: true, quote, url: args.url, status, authority, claimMatched, providerStatus: "live" };
  },
});
