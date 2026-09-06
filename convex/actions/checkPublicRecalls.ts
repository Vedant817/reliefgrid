"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { resolveFirecrawl, scrapeViaComponent, searchViaComponent } from "../lib/firecrawl";
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

// Real-world evidence drift: Firecrawl searches public recall sources for
// the need's exact product identifiers and, when an authoritative page
// confirms a matching recall, freezes every affected offer through the same
// transactional path as the controlled demo (failed source check, draft
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
    const firecrawl = resolveFirecrawl();
    if (!firecrawl.apiKey) throw new Error("no Firecrawl key configured (FIRECRAWL_API_KEY)");

    const startedAt = Date.now();
    const searchQuery = `${need.item} recall ${need.certRequired ?? ""} ${need.evidenceKey ?? ""}`.replace(/\s+/g, " ").trim();
    let hits;
    try {
      hits = (await searchViaComponent(ctx, searchQuery, 5)).hits;
    } catch (error) {
      await recordRun(ctx, {
        provider: "firecrawl",
        operation: "search_public_recalls",
        status: "failed",
        startedAt,
        requestId: searchQuery,
        meta: JSON.stringify({ error: error instanceof Error ? error.message : "unknown" }),
        ownerId,
      });
      throw error;
    }
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
      try {
        const scraped = await scrapeViaComponent(ctx, candidate.url);
        quote = `${scraped.title} — ${scraped.quote}`;
      } catch {
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
        provider: "firecrawl",
        operation: "search_public_recalls",
        status: "live",
        startedAt,
        requestId: candidate.url,
        meta: JSON.stringify({ invalidated: result.invalidated }),
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
      provider: "firecrawl",
      operation: "search_public_recalls",
      status: "live",
      startedAt,
      requestId: searchQuery,
      meta: JSON.stringify({ checked: candidates.length, result: "clear" }),
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
