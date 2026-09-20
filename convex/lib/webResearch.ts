import { resolveExa } from "./exa";
import { resolveFirecrawl } from "./firecrawl";
import { recordRun } from "./runs";

declare const process: { env: Record<string, string | undefined> };

export type WebResearchProvider = "firecrawl" | "exa";
export type ProviderFailure = { provider: WebResearchProvider; error: string };

export class WebResearchError extends Error {
  constructor(public readonly failures: ProviderFailure[]) {
    super(failures.length
      ? `Web research providers failed: ${failures.map((failure) => `${failure.provider}: ${failure.error}`).join("; ")}`
      : "No web research provider configured (set FIRECRAWL_API_KEY or EXA_API_KEY)");
    this.name = "WebResearchError";
  }
}

export function resolveWebResearch(env: Record<string, string | undefined> = process.env) {
  return {
    firecrawlApiKey: resolveFirecrawl(env).apiKey,
    exaApiKey: resolveExa(env).apiKey,
  };
}

export async function withWebResearchFallback<T>(args: {
  firecrawlApiKey: string | null;
  exaApiKey: string | null;
  firecrawl: () => Promise<T>;
  exa: () => Promise<T>;
  prefer?: WebResearchProvider;
}): Promise<{ value: T; provider: WebResearchProvider; failures: ProviderFailure[] }> {
  const failures: ProviderFailure[] = [];
  const order: WebResearchProvider[] = args.prefer === "exa" ? ["exa", "firecrawl"] : ["firecrawl", "exa"];
  for (const provider of order) {
    const configured = provider === "firecrawl" ? args.firecrawlApiKey : args.exaApiKey;
    if (!configured) continue;
    try {
      const value = await (provider === "firecrawl" ? args.firecrawl() : args.exa());
      return { value, provider, failures };
    } catch (error) {
      failures.push({ provider, error: error instanceof Error ? error.message : "unknown provider error" });
    }
  }
  throw new WebResearchError(failures);
}

export async function recordWebFailures(
  ctx: any,
  failures: ProviderFailure[],
  details: { operation: string; startedAt: number; requestId: string; ownerId: string },
) {
  for (const failure of failures) {
    await recordRun(ctx, {
      provider: failure.provider,
      operation: details.operation,
      status: "failed",
      startedAt: details.startedAt,
      requestId: details.requestId,
      meta: JSON.stringify({ error: failure.error, fallbackAttempted: true }),
      ownerId: details.ownerId,
    });
  }
}
