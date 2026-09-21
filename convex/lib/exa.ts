import type { ScrapedSource, SearchHit } from "./firecrawl";
import { extractPublicContactEmail } from "./supplierDiscovery";

declare const process: { env: Record<string, string | undefined> };

export type ExaConfig = { apiKey: string | null };

export function resolveExa(env: Record<string, string | undefined> = process.env): ExaConfig {
  return { apiKey: env.EXA_API_KEY ?? null };
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type ExaResult = {
  url?: unknown;
  title?: unknown;
  text?: unknown;
  highlights?: unknown;
};

type ExaResponse = {
  requestId?: unknown;
  results?: unknown;
  error?: unknown;
};

async function exaRequest(
  path: "/search" | "/contents",
  body: Record<string, unknown>,
  apiKey: string,
  fetchImpl: FetchLike,
): Promise<ExaResponse> {
  const response = await fetchImpl(`https://api.exa.ai${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => ({}));
  const parsed = typeof payload === "object" && payload !== null ? payload as ExaResponse : {};
  if (!response.ok) {
    const detail = typeof parsed.error === "string" ? parsed.error : `HTTP ${response.status}`;
    throw new Error(`Exa request failed (${response.status}): ${detail}`);
  }
  return parsed;
}

function resultsFrom(payload: ExaResponse): ExaResult[] {
  return Array.isArray(payload.results)
    ? payload.results.filter((item): item is ExaResult => typeof item === "object" && item !== null)
    : [];
}

function excerpt(result: ExaResult): string {
  if (Array.isArray(result.highlights)) {
    const highlight = result.highlights.find((value): value is string => typeof value === "string" && value.trim().length > 0);
    if (highlight) return highlight.replace(/\s+/g, " ").trim();
  }
  return typeof result.text === "string" ? result.text.replace(/\s+/g, " ").trim() : "";
}

export async function searchViaExa(
  query: string,
  limit = 5,
  options: { apiKey?: string; fetchImpl?: FetchLike } = {},
): Promise<{ hits: SearchHit[]; requestId: string; latencyMs: number }> {
  const apiKey = options.apiKey ?? resolveExa().apiKey;
  if (!apiKey) throw new Error("no Exa key configured (EXA_API_KEY)");
  const startedAt = Date.now();
  const payload = await exaRequest("/search", {
    query,
    type: "auto",
    numResults: Math.max(1, Math.min(Math.floor(limit), 10)),
    contents: { highlights: true, maxAgeHours: 24 },
  }, apiKey, options.fetchImpl ?? fetch);
  const hits: SearchHit[] = [];
  for (const item of resultsFrom(payload)) {
    const url = typeof item.url === "string" ? item.url : "";
    if (!url || hits.some((hit) => hit.url === url)) continue;
    const title = typeof item.title === "string" && item.title.trim() ? item.title.trim() : url;
    const sourceExcerpt = excerpt(item);
    hits.push({
      url,
      title: title.slice(0, 120),
      snippet: sourceExcerpt.slice(0, 200),
      contactEmail: extractPublicContactEmail(sourceExcerpt),
    });
    if (hits.length >= limit) break;
  }
  return {
    hits,
    requestId: typeof payload.requestId === "string" ? payload.requestId : query,
    latencyMs: Date.now() - startedAt,
  };
}

export async function scrapeViaExa(
  url: string,
  options: { apiKey?: string; fetchImpl?: FetchLike } = {},
): Promise<ScrapedSource> {
  const apiKey = options.apiKey ?? resolveExa().apiKey;
  if (!apiKey) throw new Error("no Exa key configured (EXA_API_KEY)");
  const startedAt = Date.now();
  const payload = await exaRequest("/contents", {
    urls: [url],
    text: true,
    maxAgeHours: 0,
  }, apiKey, options.fetchImpl ?? fetch);
  const result = resultsFrom(payload)[0];
  const text = result ? excerpt(result) : "";
  if (!text) throw new Error("Exa returned empty content");
  return {
    requestId: typeof payload.requestId === "string" ? payload.requestId : url,
    title: typeof result.title === "string" && result.title.trim() ? result.title.trim() : url,
    quote: text.slice(0, 300),
    latencyMs: Date.now() - startedAt,
  };
}
