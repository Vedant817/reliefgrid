"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { api, internal } from "../_generated/api";
import { resolveFirecrawl, scrapeViaComponent } from "../lib/firecrawl";
import { checkLimit } from "../rateLimits";

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sourceAuthority(hostname: string) {
  const host = hostname.toLowerCase();
  return host.endsWith(".gov") || host === "nsf.org" || host.endsWith(".nsf.org") || host === "who.int" || host.endsWith(".who.int")
    ? "authoritative" as const
    : "supporting" as const;
}

function normalized(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function containsExactPhrase(body: string, phrase: string) {
  const escaped = normalized(phrase).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return Boolean(escaped) && new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`).test(body);
}

// Live-only Firecrawl verification. There is no mock lane: missing keys or
// provider errors throw after recording a failed run, so verification state
// is never silently fabricated.
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
    const firecrawl = resolveFirecrawl();
    if (!firecrawl.apiKey) throw new Error("no Firecrawl key configured (FIRECRAWL_API_KEY)");

    let scraped;
    try {
      scraped = await scrapeViaComponent(ctx, args.url);
    } catch (e) {
      await ctx.runMutation(internal.health.recordProviderRun, {
        provider: "firecrawl",
        operation: `verify_${args.type}`,
        status: "failed",
        latencyMs: Date.now() - startedAt,
        requestId: String(args.offerId),
        meta: JSON.stringify({ error: e instanceof Error ? e.message : "unknown", url: args.url }),
        ownerId: offer.ownerId,
      });
      throw e;
    }

    const quote = `${scraped.title} — ${scraped.quote}`;
    const authority = sourceAuthority(host);
    const body = normalized(quote);
    const claim = args.type === "cert" ? offer.need.certRequired ?? "certification" : `${args.type} status`;
    const phraseMatched = args.type === "cert"
      ? Boolean(offer.need.certRequired && body.includes(normalized(offer.need.certRequired)))
      : args.type === "recall"
        ? /recall active|recalled|do not use|stop distribution/.test(body)
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
      contentHash: await sha256(quote),
      matched: claimMatched,
    });
    await ctx.runMutation(internal.allocations.computeAllocationInternal, { needId: offer.needId });
    await ctx.runMutation(internal.health.recordProviderRun, {
      provider: "firecrawl",
      operation: `verify_${args.type}`,
      status: "live",
      latencyMs: scraped.latencyMs,
      requestId: scraped.requestId,
      ownerId: offer.ownerId,
    });

    return { ok: true, quote, url: args.url, status, authority, claimMatched, providerStatus: "live" };
  },
});
