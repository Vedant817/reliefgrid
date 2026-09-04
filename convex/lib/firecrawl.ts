import { FirecrawlClient } from "@firecrawl/firecrawl-convex";
import { components } from "../_generated/api";

declare const process: { env: Record<string, string | undefined> };

export type FirecrawlConfig = { apiKey: string | null };

export function resolveFirecrawl(env: Record<string, string | undefined> = process.env): FirecrawlConfig {
  return { apiKey: env.FIRECRAWL_API_KEY ?? null };
}

export type ScrapedSource = {
  requestId: string;
  title: string;
  quote: string;
  latencyMs: number;
};

// One-shot scrape through the official Firecrawl component (v2 API with
// retries and credit tracking) returning the page title plus a short
// markdown excerpt for a source-check quote. Throws on provider errors so
// callers record failed runs instead of fabricating verification.
export async function scrapeViaComponent(ctx: any, url: string): Promise<ScrapedSource> {
  const startedAt = Date.now();
  const client = new FirecrawlClient(components.firecrawl);
  const doc = await client.scrape(ctx, url, { formats: ["markdown"], onlyMainContent: true });
  const markdown = (doc.markdown ?? "").replace(/\s+/g, " ").trim();
  if (!markdown) throw new Error("Firecrawl returned empty content");
  return {
    requestId: ((doc as Record<string, unknown>).id as string | undefined) ?? url,
    title: doc.metadata?.title ?? url,
    quote: markdown.slice(0, 300),
    latencyMs: Date.now() - startedAt,
  };
}
