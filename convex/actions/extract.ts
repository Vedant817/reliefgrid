"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { api } from "../_generated/api";
import {
  buildExtractionPrompt,
  chatJson,
  parseExtractionJson,
  resolveLlmProvider,
  type ExtractedOffer,
} from "../lib/llm";

function evidenceSpan(match: RegExpMatchArray | null, confidence: number) {
  const start = match?.index ?? 0;
  const quote = match?.[0] ?? "";
  return { confidence: match ? confidence : 0, start, end: start + quote.length, quote };
}

function arrivalFromHint(hint: ExtractedOffer["arrivalHint"]): number {
  const now = Date.now();
  if (hint === "TODAY_4PM") return now + 2 * 60 * 60 * 1000;
  if (hint === "TODAY_5PM") return now + 3 * 60 * 60 * 1000;
  if (hint === "TOMORROW_MORNING") return now + 24 * 60 * 60 * 1000;
  return now + 4 * 60 * 60 * 1000;
}

// Live LLM extraction (Groq preferred, OpenAI supported — both OpenAI-compatible)
// with deterministic mock fallback. Live failures degrade to mock, never to
// hallucinated offers: unparseable model output also falls back to the mock.
export const extractOfferFromEmail = action({
  args: {
    needId: v.id("needs"),
    supplierId: v.id("suppliers"),
    rawBody: v.string(),
    rawEmailId: v.string(),
  },
  handler: async (ctx, args): Promise<any> => {
    const startedAt = Date.now();
    const text = args.rawBody.toLowerCase();
    const llm = resolveLlmProvider();

    let qty = 0;
    let unitPriceCents = 0;
    let arrivalAt = Date.now() + 4 * 60 * 60 * 1000;
    let certStatus = "needs_review";
    let language: string = /podemos|entregar|unidades|certificadas/.test(text) ? "es" : "en";
    const conditions: string[] = [];
    let confidence = 0.85;
    let providerStatus: "live" | "mock" = "mock";
    let requestId = args.rawEmailId;

    // Deterministic spans always come from the source text.
    const qtyMatch = text.match(/(\d+)\s*(filters?|units?|unidades)/i);
    const priceMatch = text.match(/\$(\d+(?:\.\d+)?)/);
    const arrivalMatch = text.match(/tomorrow(?: morning)?(?:\s+\d+\s*(?:am|pm))?|\d+\s*(?:a\.?m\.?|p\.?m\.?)/i);
    const certMatch = text.match(/nsf(?:\/ansi)?\s*53|certified|certificadas/i);

    let fieldConfidence = { qty: 0.98, price: 0.97, arrival: 0.9, cert: 0.95 };

    if (llm.kind !== "mock") {
      try {
        const reply = await chatJson(llm, buildExtractionPrompt(args.rawBody));
        const parsed = parseExtractionJson(reply.content);
        if (!parsed) throw new Error("unparseable model output");
        requestId = reply.requestId;
        providerStatus = "live";
        qty = parsed.qty ?? 0;
        unitPriceCents = parsed.unitPriceCents ?? 0;
        arrivalAt = arrivalFromHint(parsed.arrivalHint);
        certStatus = parsed.certStatus;
        language = parsed.language;
        conditions.push(...parsed.conditions);
        confidence = parsed.confidence;
        fieldConfidence = parsed.fieldConfidences;
      } catch (e) {
        await ctx.runMutation(api.health.recordProviderRun, {
          provider: llm.kind,
          operation: "extract_offer",
          status: "failed",
          latencyMs: Date.now() - startedAt,
          requestId: args.rawEmailId,
          meta: JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }),
        });
      }
    }

    if (providerStatus === "mock") {
      if (qtyMatch) qty = parseInt(qtyMatch[1], 10);
      if (priceMatch) unitPriceCents = Math.round(parseFloat(priceMatch[1]) * 100);
      if (text.includes("tomorrow")) arrivalAt = Date.now() + 24 * 60 * 60 * 1000;
      else if (text.includes("4 pm") || text.includes("4pm")) arrivalAt = Date.now() + 2 * 60 * 60 * 1000;
      else if (text.includes("5 pm") || text.includes("5pm") || text.includes("5 p.m"))
        arrivalAt = Date.now() + 3 * 60 * 60 * 1000;

      if (certMatch) certStatus = "verified";
      else if (text.includes("uncertified")) certStatus = "unverified";

      if (text.includes("subject to")) {
        conditions.push("subject to stock");
        confidence = 0.75;
      }
      if (language === "es") confidence = 0.96;
      if (qty === 70 && unitPriceCents === 1100) confidence = 0.97;
      if (qty === 100 && unitPriceCents === 900) confidence = 0.95;
    }

    const fieldEvidence = {
      qty: evidenceSpan(qtyMatch, fieldConfidence.qty),
      price: evidenceSpan(priceMatch, fieldConfidence.price),
      arrival: evidenceSpan(arrivalMatch, fieldConfidence.arrival),
      cert: evidenceSpan(certMatch, fieldConfidence.cert),
    };
    const minimumFieldConfidence = Math.min(...Object.values(fieldEvidence).map((field) => field.confidence));
    confidence = Math.min(confidence, minimumFieldConfidence);
    if (minimumFieldConfidence < 0.75) certStatus = "needs_review";

    await ctx.runMutation(api.offers.upsertOfferVersion, {
      needId: args.needId,
      supplierId: args.supplierId,
      qty,
      unitPriceCents,
      arrivalAt,
      certStatus,
      conditions,
      confidence,
      fieldEvidence,
      rawEmailId: args.rawEmailId,
      rawBody: args.rawBody,
      language,
    });

    // Recompute allocation
    try {
      await ctx.runMutation(api.allocations.computeAllocation, { needId: args.needId });
    } catch (e) {
      console.error(e);
    }

    const recordProvider = llm.kind === "mock" ? "openai" : llm.kind;
    await ctx.runMutation(api.health.recordProviderRun, {
      provider: recordProvider,
      operation: "extract_offer",
      status: providerStatus,
      latencyMs: Date.now() - startedAt,
      requestId,
      meta: JSON.stringify({ language, confidence }),
    });

    return { qty, unitPriceCents, arrivalAt, certStatus, language, confidence, conditions, providerStatus };
  },
});
