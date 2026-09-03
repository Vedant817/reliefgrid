"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { api } from "../_generated/api";

// Mock Firecrawl verification — in production, use firecrawl scrape
export const verifyOffer = action({
  args: {
    offerId: v.id("offers"),
    type: v.string(), // cert, recall, spec
    url: v.string(),
  },
  handler: async (ctx, args): Promise<any> => {
    // Simulate Firecrawl result
    const quotes: Record<string, string> = {
      cert: "NSF/ANSI 53 certified — see manufacturer spec sheet page 2",
      recall: "No active recall found for this model in CPSC registry",
      spec: "Portable water filter, flow rate 1.5L/min, NSF/ANSI 53",
    };
    const quote = quotes[args.type] ?? "Verified via official source";

    await ctx.runMutation(api.sourceChecks.addSourceCheck, {
      offerId: args.offerId,
      url: args.url,
      quote,
      status: "verified",
      reason: `Firecrawl verification passed for ${args.type}`,
      type: args.type,
    });

    void ctx.runQuery;

    return { ok: true, quote, url: args.url };
  },
});

export const verifyNeedSources = action({
  args: { needId: v.id("needs") },
  handler: async (ctx, args): Promise<any> => {
    const offers: any = await ctx.runQuery(api.offers.listOffersByNeed, { needId: args.needId });
    for (const o of offers) {
      await ctx.runMutation(api.sourceChecks.addSourceCheck, {
        offerId: o._id,
        url: `https://example.com/specs/${o._id}`,
        quote: "Spec verified: NSF/ANSI 53, flow 1.5L/min",
        status: o.certStatus === "verified" ? "verified" : "needs_review",
        reason: o.certStatus === "verified" ? "Cert page confirms" : "Cert not found",
        type: "cert",
      });
      await ctx.runMutation(api.sourceChecks.addSourceCheck, {
        offerId: o._id,
        url: `https://cpsc.gov/recalls/search?model=filter`,
        quote: "No active recall found",
        status: "verified",
        reason: "Recall registry clean",
        type: "recall",
      });
    }
    return { verified: offers.length };
  },
});
