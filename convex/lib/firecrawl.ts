import { FirecrawlClient } from "@firecrawl/firecrawl-convex";
import { components } from "../_generated/api";
import { extractPublicContactEmail } from "./supplierDiscovery";

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

export type SearchHit = {
  url: string;
  title: string;
  snippet: string;
  contactEmail?: string;
};

// Web search through the official Firecrawl component. Returns normalized
// hits only — callers decide what counts as evidence and record provider
// runs themselves, so a search never silently becomes verification.
function firecrawlFailure(error: unknown, operation: string): never {
  const detail = error instanceof Error ? error.message : "unknown Firecrawl error";
  throw new Error(`Firecrawl ${operation} failed: ${detail}`);
}

export async function searchViaComponent(ctx: any, query: string, limit = 5): Promise<{ hits: SearchHit[]; requestId: string; latencyMs: number }> {
  const startedAt = Date.now();
  const client = new FirecrawlClient(components.firecrawl);
  let response;
  try {
    response = await client.search(ctx, query, {
      sources: ["web"],
      limit,
      scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
    });
  } catch (error) {
    firecrawlFailure(error, "search");
  }
  const raw = [...(response.web ?? []), ...(response.news ?? [])];
  const hits: SearchHit[] = [];
  for (const item of raw) {
    const url = typeof item.url === "string" ? item.url : "";
    if (!url) continue;
    const title = typeof item.title === "string" && item.title ? item.title : url;
    const snippet = typeof item.description === "string" ? item.description.slice(0, 200) : "";
    const markdown = typeof item.markdown === "string" ? item.markdown : "";
    const contactEmail = extractPublicContactEmail(`${snippet}\n${markdown}`);
    if (!hits.some((hit) => hit.url === url)) hits.push({ url, title: title.slice(0, 120), snippet, contactEmail });
    if (hits.length >= limit) break;
  }
  return { hits, requestId: query, latencyMs: Date.now() - startedAt };
}

// One-shot scrape through the official Firecrawl component (v2 API with
// retries and credit tracking) returning the page title plus a short
// markdown excerpt for a source-check quote. Throws on provider errors so
// callers record failed runs instead of fabricating verification.
export async function scrapeViaComponent(ctx: any, url: string): Promise<ScrapedSource> {
  const startedAt = Date.now();
  const client = new FirecrawlClient(components.firecrawl);
  let doc;
  try {
    doc = await client.scrape(ctx, url, { formats: ["markdown"], onlyMainContent: true });
  } catch (error) {
    firecrawlFailure(error, "scrape");
  }
  const markdown = (doc.markdown ?? "").replace(/\s+/g, " ").trim();
  if (!markdown) throw new Error("Firecrawl returned empty content");
  return {
    requestId: ((doc as Record<string, unknown>).id as string | undefined) ?? url,
    title: doc.metadata?.title ?? url,
    quote: markdown.slice(0, 300),
    latencyMs: Date.now() - startedAt,
  };
}
