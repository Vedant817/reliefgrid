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

// Synchronous v1 scrape returning the page title plus a short markdown
// excerpt suitable for a source-check quote. Throws on provider errors
// (including 402 out-of-credits) so callers degrade to the labeled mock.
export async function scrapeSource(
  config: FirecrawlConfig,
  url: string,
  timeoutMs = 45000,
): Promise<ScrapedSource> {
  if (!config.apiKey) throw new Error("no Firecrawl key configured");
  const startedAt = Date.now();
  const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, timeout: timeoutMs }),
    signal: AbortSignal.timeout(timeoutMs + 10000),
  });
  if (!res.ok) throw new Error(`Firecrawl HTTP ${res.status}`);
  const body = (await res.json()) as {
    success?: boolean;
    id?: string;
    data?: { markdown?: string; metadata?: { title?: string } };
  };
  if (!body.success) throw new Error("Firecrawl scrape unsuccessful");
  const markdown = (body.data?.markdown ?? "").replace(/\s+/g, " ").trim();
  if (!markdown) throw new Error("Firecrawl returned empty content");
  return {
    requestId: body.id ?? url,
    title: body.data?.metadata?.title ?? url,
    quote: markdown.slice(0, 300),
    latencyMs: Date.now() - startedAt,
  };
}
