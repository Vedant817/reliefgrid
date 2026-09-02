"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { api } from "../_generated/api";

// Mock OpenAI extraction — in production, call OpenAI via AI Gateway
// This keeps the contract: language → structured offer, confidence + conditions
export const extractOfferFromEmail = action({
  args: {
    needId: v.id("needs"),
    supplierId: v.id("suppliers"),
    rawBody: v.string(),
    rawEmailId: v.string(),
  },
  handler: async (ctx, args): Promise<any> => {
    const text = args.rawBody.toLowerCase();

    // Deterministic extraction rules for MVP (replace with OpenAI call)
    let qty = 0;
    let unitPriceCents = 0;
    let arrivalAt = Date.now() + 4 * 60 * 60 * 1000;
    let certStatus = "needs_review";
    let language = /podemos|entregar|unidades|certificadas/.test(text) ? "es" : "en";
    const conditions: string[] = [];
    let confidence = 0.85;

    // qty
    const qtyMatch = text.match(/(\d+)\s*(filters?|units?|unidades)/i);
    if (qtyMatch) qty = parseInt(qtyMatch[1], 10);

    // price
    const priceMatch = text.match(/\$(\d+(?:\.\d+)?)/);
    if (priceMatch) unitPriceCents = Math.round(parseFloat(priceMatch[1]) * 100);

    // arrival
    if (text.includes("tomorrow")) arrivalAt = Date.now() + 24 * 60 * 60 * 1000;
    else if (text.includes("4 pm") || text.includes("4pm")) arrivalAt = Date.now() + 2 * 60 * 60 * 1000;
    else if (text.includes("5 pm") || text.includes("5pm") || text.includes("5 p.m")) arrivalAt = Date.now() + 3 * 60 * 60 * 1000;

    // cert
    if (text.includes("nsf") || text.includes("certified") || text.includes("certificadas")) certStatus = "verified";
    else if (text.includes("uncertified")) certStatus = "unverified";

    if (text.includes("subject to")) {
      conditions.push("subject to stock");
      confidence = 0.75;
    }
    if (language === "es") confidence = 0.96;
    if (qty === 70 && unitPriceCents === 1100) confidence = 0.97;
    if (qty === 100 && unitPriceCents === 900) confidence = 0.95;

    await ctx.runMutation(api.offers.upsertOfferVersion, {
      needId: args.needId,
      supplierId: args.supplierId,
      qty,
      unitPriceCents,
      arrivalAt,
      certStatus,
      conditions,
      confidence,
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

    return { qty, unitPriceCents, arrivalAt, certStatus, language, confidence, conditions };
  },
});
