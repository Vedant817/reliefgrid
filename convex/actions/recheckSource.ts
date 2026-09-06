"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { scrapeViaComponent } from "../lib/firecrawl";
import { sha256Hex } from "../lib/evidence";
import { recordRun } from "../lib/runs";
import { checkLimit } from "../rateLimits";
import type { Id } from "../_generated/dataModel";

declare const process: { env: Record<string, string | undefined> };

export const activateRecallAndRecheck = action({
  args: { needId: v.id("needs") },
  returns: v.object({ planId: v.id("allocationPlans"), totalQty: v.number(), totalCostCents: v.number(), sourceUrl: v.string() }),
  handler: async (ctx, args): Promise<{ planId: Id<"allocationPlans">; totalQty: number; totalCostCents: number; sourceUrl: string }> => {
    const need: any = await ctx.runQuery(api.needs.getDemoNeed, args);
    await checkLimit(ctx, "verifySource", `drift:${String(args.needId)}`, need.ownerId);
    const bulletinId: Id<"demoBulletins"> = await ctx.runMutation(internal.evidenceDrift.setBulletinRecall, { needId: args.needId });
    try {
      const siteUrl = process.env.CONVEX_SITE_URL;
      if (!siteUrl) throw new Error("CONVEX_SITE_URL is unavailable");
      const sourceUrl: string = `${siteUrl}/demo-bulletin?id=${encodeURIComponent(String(bulletinId))}`;
      const scraped = await scrapeViaComponent(ctx, sourceUrl);
      const quote = `${scraped.title} — ${scraped.quote}`;
      const normalized = quote.toLowerCase();
      if (!normalized.includes("recall active") || !normalized.includes("nf-53")) {
        throw new Error("Firecrawl did not confirm the expected recall bulletin");
      }
      const result: any = await ctx.runMutation(internal.evidenceDrift.applyVerifiedRecall, {
        needId: args.needId,
        sourceUrl,
        quote,
        contentHash: await sha256Hex(quote),
      });
      await recordRun(ctx, {
        provider: "firecrawl",
        operation: "recheck_controlled_bulletin",
        status: "live",
        latencyMs: scraped.latencyMs,
        requestId: scraped.requestId,
        ownerId: need.ownerId,
      });
      return { planId: result.planId, totalQty: result.totalQty, totalCostCents: result.totalCostCents, sourceUrl };
    } catch (error) {
      await ctx.runMutation(internal.evidenceDrift.restoreBulletinClear, { bulletinId });
      throw error;
    }
  },
});
