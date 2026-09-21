"use node";

import { action, internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import {
  buildExtractionPrompt,
  chatExtractedOfferWithFallback,
  LlmProviderError,
  type ExtractedOffer,
} from "../lib/llm";
import { MIN_EVIDENCE_CONFIDENCE } from "../lib/allocate";
import { recordRun } from "../lib/runs";
import { checkLimit } from "../rateLimits";
import { parseSupplierArrival } from "../lib/timezone";

function evidenceSpan(match: RegExpMatchArray | null, confidence: number) {
  const start = match?.index ?? 0;
  const quote = match?.[0] ?? "";
  return { confidence: match ? confidence : 0, start, end: start + quote.length, quote };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function certMatchFrom(text: string, certRequired?: string) {
  if (certRequired?.trim()) {
    const named = text.match(new RegExp(escapeRegExp(certRequired.trim()).replace(/\s+/g, "\\s+"), "i"));
    if (named) return named;
  }
  return text.match(/certified|certification|certificadas/i);
}

// Live LLM extraction: OpenAI first, Groq (GPT-OSS) if OpenAI is missing or
// fails. Missing keys and provider failures throw after recording failed runs.
// Ambiguous emails remain explicitly incomplete so the allocator can request clarification.
export const extractOfferFromEmail = internalAction({
  args: {
    needId: v.id("needs"),
    supplierId: v.id("suppliers"),
    rawBody: v.string(),
    rawEmailId: v.string(),
    receivedAt: v.optional(v.number()),
  },
  returns: v.object({
    qty: v.number(),
    unitPriceCents: v.number(),
    arrivalAt: v.optional(v.number()),
    certStatus: v.string(),
    language: v.string(),
    confidence: v.number(),
    conditions: v.array(v.string()),
    providerStatus: v.literal("live"),
    provider: v.union(v.literal("openai"), v.literal("groq")),
  }),
  handler: async (ctx, args) => {
    if (!args.rawBody.trim() || args.rawBody.length > 100_000) throw new Error("Supplier email must be 1-100000 characters");
    const context = await ctx.runQuery(internal.offers.getExtractionContext, {
      needId: args.needId,
      supplierId: args.supplierId,
    });
    await checkLimit(ctx, "extractOffer", String(args.needId));
    const startedAt = Date.now();
    const text = args.rawBody.toLowerCase();
    let parsed: ExtractedOffer;
    let requestId: string;
    let providerKind: "openai" | "groq" = "openai";
    let providerModel = "";
    try {
      const receivedAt = args.receivedAt ?? Date.now();
      if (!Number.isFinite(receivedAt)) throw new Error("Invalid supplier email receipt time");
      const reply = await chatExtractedOfferWithFallback(
        buildExtractionPrompt(args.rawBody, new Date(receivedAt).toISOString(), context.timezone),
      );
      parsed = reply.offer;
      requestId = reply.requestId;
      providerKind = reply.provider;
      providerModel = reply.model;
      for (const failure of reply.failures) {
        await recordRun(ctx, {
          provider: failure.provider,
          operation: "extract_offer",
          status: "failed",
          startedAt,
          requestId: args.rawEmailId,
          meta: JSON.stringify({ error: failure.error, fallbackAttempted: true }),
          ownerId: context.ownerId,
        });
      }
    } catch (e) {
      const failures = e instanceof LlmProviderError
        ? e.failures
        : [{ provider: "openai" as const, error: e instanceof Error ? e.message : "unknown" }];
      if (!failures.length) {
        await recordRun(ctx, {
          provider: "openai",
          operation: "extract_offer",
          status: "failed",
          startedAt,
          requestId: args.rawEmailId,
          meta: JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }),
          ownerId: context.ownerId,
        });
      }
      for (const failure of failures) {
        await recordRun(ctx, {
          provider: failure.provider,
          operation: "extract_offer",
          status: "failed",
          startedAt,
          requestId: args.rawEmailId,
          meta: JSON.stringify({ error: failure.error }),
          ownerId: context.ownerId,
        });
      }
      throw e;
    }

    const qty = parsed.qty ?? 0;
    const unitPriceCents = parsed.unitPriceCents ?? 0;
    const arrivalAt = parseSupplierArrival(parsed.arrivalAtIso, context.timezone);
    // Supplier claims are never authoritative verification. A source check
    // must promote the offer before the allocator may use it.
    let certStatus: string = parsed.certStatus === "unverified" ? "unverified" : "needs_review";
    const language: string = parsed.language;
    const conditions = parsed.conditions;
    let confidence = parsed.confidence;

    // Deterministic spans always come from the source text.
    const qtyMatch = text.match(/(\d[\d,]*)\s*(?:filters?|units?|unidades|pcs?|pieces?|boxes?|kits?|items?|each)?/i);
    const priceMatch = text.match(/\$(\d+(?:\.\d+)?)/);
    const arrivalMatch = text.match(/(?:guaranteed\s+)?(?:by|on|before|deliver(?:y|ed)?\s+(?:by|on)?)?\s*(?:tomorrow(?:\s+(?:morning|afternoon|evening))?|(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?|\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+\d{4})?|\d{4}-\d{2}-\d{2})(?:\s+(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))?/i);
    const certMatch = certMatchFrom(text, context.certRequired);
    const certRequired = Boolean(context.certRequired?.trim());
    const fieldEvidence = {
      qty: evidenceSpan(qtyMatch, parsed.fieldConfidences.qty),
      price: evidenceSpan(priceMatch, parsed.fieldConfidences.price),
      arrival: evidenceSpan(arrivalAt !== undefined ? arrivalMatch : null, parsed.fieldConfidences.arrival),
      cert: certRequired
        ? evidenceSpan(certMatch, parsed.fieldConfidences.cert)
        : { confidence: 1, start: 0, end: 0, quote: "" },
    };
    const scoredFields = certRequired
      ? Object.values(fieldEvidence)
      : [fieldEvidence.qty, fieldEvidence.price, fieldEvidence.arrival];
    const minimumFieldConfidence = Math.min(...scoredFields.map((field) => field.confidence));
    confidence = Math.min(confidence, minimumFieldConfidence);
    if (certRequired && minimumFieldConfidence < MIN_EVIDENCE_CONFIDENCE) certStatus = "needs_review";
    if (!certRequired && certStatus === "needs_review") certStatus = "unverified";

    await ctx.runMutation(internal.offers.upsertOfferVersion, {
      needId: args.needId,
      supplierId: args.supplierId,
      qty,
      unitPriceCents,
      ...(arrivalAt === undefined ? {} : { arrivalAt }),
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
      await ctx.runMutation(internal.allocations.computeAllocationInternal, { needId: args.needId });
    } catch (e) {
      console.error(e);
    }

    await recordRun(ctx, {
      provider: providerKind,
      operation: "extract_offer",
      status: "live",
      startedAt,
      requestId,
      meta: JSON.stringify({ language, confidence, model: providerModel, fallback: providerKind === "groq" }),
      ownerId: context.ownerId,
    });

    return { qty, unitPriceCents, ...(arrivalAt === undefined ? {} : { arrivalAt }), certStatus, language, confidence, conditions, providerStatus: "live" as const, provider: providerKind };
  },
});

// Coordinator-pasted quote: same extraction path as inbound email, after an
// ownership check. The pasted text is real supplier correspondence, not a fixture.
export const ingestPastedQuote = action({
  args: {
    needId: v.id("needs"),
    supplierId: v.id("suppliers"),
    rawBody: v.string(),
  },
  returns: v.object({
    qty: v.number(),
    unitPriceCents: v.number(),
    arrivalAt: v.optional(v.number()),
    certStatus: v.string(),
    language: v.string(),
    confidence: v.number(),
    conditions: v.array(v.string()),
    providerStatus: v.literal("live"),
    provider: v.union(v.literal("openai"), v.literal("groq")),
  }),
  handler: async (ctx, args): Promise<{
    qty: number;
    unitPriceCents: number;
    arrivalAt?: number;
    certStatus: string;
    language: string;
    confidence: number;
    conditions: string[];
    providerStatus: "live";
    provider: "openai" | "groq";
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");
    const prepared: { ownerId: string; rawEmailId: string; rawBody: string } = await ctx.runMutation(
      internal.quotes.preparePastedQuote,
      args,
    );
    const extracted: {
      qty: number;
      unitPriceCents: number;
      arrivalAt?: number;
      certStatus: string;
      language: string;
      confidence: number;
      conditions: string[];
      providerStatus: "live";
      provider: "openai" | "groq";
    } = await ctx.runAction(internal.actions.extract.extractOfferFromEmail, {
      needId: args.needId,
      supplierId: args.supplierId,
      rawBody: prepared.rawBody,
      rawEmailId: prepared.rawEmailId,
      receivedAt: Date.now(),
    });
    return extracted;
  },
});
