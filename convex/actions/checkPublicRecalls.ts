"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { scrapeViaComponent, searchViaComponent } from "../lib/firecrawl";
import { scrapeViaExa, searchViaExa } from "../lib/exa";
import { WebResearchError, recordWebFailures, resolveWebResearch, withWebResearchFallback } from "../lib/webResearch";
import {
  RECALL_LANGUAGE,
  containsExactPhrase,
  isAuthoritativeHostname,
  normalized,
  sha256Hex,
} from "../lib/evidence";
import { checkLimit } from "../rateLimits";
import { recordRun } from "../lib/runs";
import type { Id } from "../_generated/dataModel";

// Real-world evidence drift: Firecrawl searches public recall sources first,
// with Exa as the live fallback. The same exact-match and authoritative-source
// policy checks the need's product identifiers. A confirmed matching recall
// freezes every affected offer through the same transactional evidence path
// (failed source check, draft
// hold notice, recompute, audit). No match means no writes at all.
export const checkPublicRecalls = action({
  args: { needId: v.id("needs") },
  returns: v.object({
    recalled: v.boolean(),
    checked: v.number(),
    note: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    quote: v.optional(v.string()),
    invalidated: v.optional(v.number()),
    planId: v.optional(v.id("allocationPlans")),
    totalQty: v.optional(v.number()),
    totalCostCents: v.optional(v.number()),
  }),
  handler: async (ctx, args): Promise<{
    recalled: boolean; checked: number; note?: string; sourceUrl?: string; quote?: string;
    invalidated?: number; planId?: Id<"allocationPlans">; totalQty?: number; totalCostCents?: number;
  }> => {
    const access: any = await ctx.runQuery(internal.needs.getNeedOwnership, { needId: args.needId });
    const need = access.need;
    const ownerId: string = access.ownerId;
    if (!need.evidenceKey && !need.certRequired) {
      throw new Error("Add a product/model evidence key or required certification so public sources can be matched exactly");
    }
    await checkLimit(ctx, "verifySource", `public-recall:${String(args.needId)}`, ownerId);
    const startedAt = Date.now();
    const searchQuery = `${need.item} recall ${need.certRequired ?? ""} ${need.evidenceKey ?? ""}`.replace(/\s+/g, " ").trim();
    const providers = resolveWebResearch();
    let searchRetrieval;
    try {
      searchRetrieval = await withWebResearchFallback({
        ...providers,
        firecrawl: () => searchViaComponent(ctx, searchQuery, 5),
        exa: () => searchViaExa(searchQuery, 5, { apiKey: providers.exaApiKey ?? undefined }),
      });
    } catch (error) {
      if (error instanceof WebResearchError) {
        await recordWebFailures(ctx, error.failures, { operation: "search_public_recalls", startedAt, requestId: searchQuery, ownerId });
      }
      throw error;
    }
    await recordWebFailures(ctx, searchRetrieval.failures, { operation: "search_public_recalls", startedAt, requestId: searchQuery, ownerId });
    const hits = searchRetrieval.value.hits;
    const candidates = hits.filter((hit) => {
      try {
        const parsed = new URL(hit.url);
        return parsed.protocol === "https:" && isAuthoritativeHostname(parsed.hostname);
      } catch {
        return false;
      }
    }).slice(0, 3);

    for (const candidate of candidates) {
      let quote: string;
      let scrapeProvider = searchRetrieval.provider;
      try {
        const scrapedRetrieval = await withWebResearchFallback({
          ...providers,
          prefer: searchRetrieval.provider,
          firecrawl: () => scrapeViaComponent(ctx, candidate.url),
          exa: () => scrapeViaExa(candidate.url, { apiKey: providers.exaApiKey ?? undefined }),
        });
        await recordWebFailures(ctx, scrapedRetrieval.failures, {
          operation: "scrape_public_recall",
          startedAt,
          requestId: candidate.url,
          ownerId,
        });
        const scraped = scrapedRetrieval.value;
        scrapeProvider = scrapedRetrieval.provider;
        quote = `${scraped.title} — ${scraped.quote}`;
      } catch (error) {
        if (error instanceof WebResearchError) {
          await recordWebFailures(ctx, error.failures, {
            operation: "scrape_public_recall",
            startedAt,
            requestId: candidate.url,
            ownerId,
          });
        }
        continue;
      }
      const body = normalized(quote);
      if (!RECALL_LANGUAGE.test(body)) continue;
      const identifierMatched = Boolean(
        (need.evidenceKey && containsExactPhrase(body, need.evidenceKey)) ||
        (need.certRequired && body.includes(normalized(need.certRequired))),
      );
      if (!identifierMatched) continue;

      const needOffers: any[] = await ctx.runQuery(api.offers.listOffersByNeed, { needId: args.needId });
      const matching = needOffers.filter((offer) => offer.certStatus !== "failed");
      if (!matching.length) {
        return { recalled: false, checked: candidates.length, note: "A matching recall exists but every affected offer is already invalidated" };
      }
      const result: any = await ctx.runMutation(internal.evidenceDrift.applyPublicRecall, {
        needId: args.needId,
        offerIds: matching.map((offer) => offer._id),
        sourceUrl: candidate.url,
        quote,
        contentHash: await sha256Hex(quote),
      });
      await recordRun(ctx, {
        provider: scrapeProvider,
        operation: "search_public_recalls",
        status: "live",
        startedAt,
        requestId: candidate.url,
        meta: JSON.stringify({ invalidated: result.invalidated, fallback: scrapeProvider === "exa" }),
        ownerId,
      });
      return {
        recalled: true,
        checked: candidates.length,
        sourceUrl: candidate.url,
        quote,
        invalidated: result.invalidated,
        planId: result.planId,
        totalQty: result.totalQty,
        totalCostCents: result.totalCostCents,
      };
    }

    await recordRun(ctx, {
      provider: searchRetrieval.provider,
      operation: "search_public_recalls",
      status: "live",
      startedAt,
      latencyMs: searchRetrieval.value.latencyMs,
      requestId: searchRetrieval.value.requestId,
      meta: JSON.stringify({ checked: candidates.length, result: "clear", fallback: searchRetrieval.provider === "exa" }),
      ownerId,
    });
    return {
      recalled: false,
      checked: candidates.length,
      note: candidates.length
        ? "Authoritative sources were read and none reports a matching recall"
        : "No authoritative recall sources found for this product",
    };
  },
});
