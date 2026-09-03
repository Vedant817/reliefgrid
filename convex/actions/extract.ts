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

// Live-only LLM extraction (Groq preferred, OpenAI supported). There is no
// mock lane: missing keys or provider failures throw after recording a failed
// run. Genuinely ambiguous emails still yield qty 0 / needs_review so the
// allocator abstains and the clarification flow takes over.
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
    if (llm.kind === "mock") throw new Error("no LLM key configured (GROQ_API_KEY or OPENAI_API_KEY)");

    let parsed: ExtractedOffer;
    let requestId: string;
    try {
      const reply = await chatJson(llm, buildExtractionPrompt(args.rawBody));
      const result = parseExtractionJson(reply.content);
      if (!result) throw new Error("unparseable model output");
      parsed = result;
      requestId = reply.requestId;
    } catch (e) {
      await ctx.runMutation(api.health.recordProviderRun, {
        provider: llm.kind,
        operation: "extract_offer",
        status: "failed",
        latencyMs: Date.now() - startedAt,
        requestId: args.rawEmailId,
        meta: JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }),
      });
      throw e;
    }

    const qty = parsed.qty ?? 0;
    const unitPriceCents = parsed.unitPriceCents ?? 0;
    const arrivalAt = arrivalFromHint(parsed.arrivalHint);
    let certStatus: string = parsed.certStatus;
    const language: string = parsed.language;
    const conditions = parsed.conditions;
    let confidence = parsed.confidence;

    // Deterministic spans always come from the source text.
    const qtyMatch = text.match(/(\d+)\s*(filters?|units?|unidades)/i);
    const priceMatch = text.match(/\$(\d+(?:\.\d+)?)/);
    const arrivalMatch = text.match(/tomorrow(?: morning)?(?:\s+\d+\s*(?:am|pm))?|\d+\s*(?:a\.?m\.?|p\.?m\.?)/i);
    const certMatch = text.match(/nsf(?:\/ansi)?\s*53|certified|certificadas/i);

    const fieldEvidence = {
      qty: evidenceSpan(qtyMatch, parsed.fieldConfidences.qty),
      price: evidenceSpan(priceMatch, parsed.fieldConfidences.price),
      arrival: evidenceSpan(arrivalMatch, parsed.fieldConfidences.arrival),
      cert: evidenceSpan(certMatch, parsed.fieldConfidences.cert),
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

    await ctx.runMutation(api.health.recordProviderRun, {
      provider: llm.kind,
      operation: "extract_offer",
      status: "live",
      latencyMs: Date.now() - startedAt,
      requestId,
      meta: JSON.stringify({ language, confidence }),
    });

    return { qty, unitPriceCents, arrivalAt, certStatus, language, confidence, conditions, providerStatus: "live" };
  },
});
