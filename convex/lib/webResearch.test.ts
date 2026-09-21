import { describe, expect, it, vi } from "vitest";
import { WebResearchError, resolveWebResearch, withWebResearchFallback } from "./webResearch";

describe("web research provider fallback", () => {
  it("uses Firecrawl first when it succeeds", async () => {
    const firecrawl = vi.fn(async () => "firecrawl result");
    const exa = vi.fn(async () => "exa result");

    const result = await withWebResearchFallback({
      firecrawlApiKey: "fc-key",
      exaApiKey: "exa-key",
      firecrawl,
      exa,
    });

    expect(result).toEqual({ value: "firecrawl result", provider: "firecrawl", failures: [] });
    expect(exa).not.toHaveBeenCalled();
  });

  it("falls back to Exa when Firecrawl credits are exhausted", async () => {
    const result = await withWebResearchFallback({
      firecrawlApiKey: "fc-key",
      exaApiKey: "exa-key",
      firecrawl: async () => { throw new Error("Payment required: insufficient credits"); },
      exa: async () => "exa result",
    });

    expect(result).toEqual({
      value: "exa result",
      provider: "exa",
      failures: [{ provider: "firecrawl", error: "Payment required: insufficient credits" }],
    });
  });

  it("falls back to Exa when Firecrawl returns no usable results", async () => {
    const result = await withWebResearchFallback({
      firecrawlApiKey: "fc-key",
      exaApiKey: "exa-key",
      firecrawl: async () => [] as string[],
      exa: async () => ["exa result"],
      accept: (value) => value.length > 0,
    });

    expect(result.provider).toBe("exa");
    expect(result.failures).toEqual([{ provider: "firecrawl", error: "Provider returned no usable results" }]);
  });

  it("uses Exa directly when Firecrawl is not configured", async () => {
    const firecrawl = vi.fn(async () => "firecrawl result");
    const result = await withWebResearchFallback({
      firecrawlApiKey: null,
      exaApiKey: "exa-key",
      firecrawl,
      exa: async () => "exa result",
    });

    expect(result.provider).toBe("exa");
    expect(firecrawl).not.toHaveBeenCalled();
  });

  it("keeps Exa first for follow-up page reads after search fallback", async () => {
    const firecrawl = vi.fn(async () => "firecrawl result");
    const exa = vi.fn(async () => "exa result");
    const result = await withWebResearchFallback({
      firecrawlApiKey: "fc-key",
      exaApiKey: "exa-key",
      prefer: "exa",
      firecrawl,
      exa,
    });

    expect(result.provider).toBe("exa");
    expect(firecrawl).not.toHaveBeenCalled();
  });

  it("fails visibly when both configured providers fail", async () => {
    const promise = withWebResearchFallback({
      firecrawlApiKey: "fc-key",
      exaApiKey: "exa-key",
      firecrawl: async () => { throw new Error("Firecrawl unavailable"); },
      exa: async () => { throw new Error("Exa unavailable"); },
    });

    await expect(promise).rejects.toBeInstanceOf(WebResearchError);
    await expect(promise).rejects.toThrow("firecrawl: Firecrawl unavailable; exa: Exa unavailable");
  });

  it("reports configured providers", () => {
    expect(resolveWebResearch({ FIRECRAWL_API_KEY: "fc", EXA_API_KEY: "exa" })).toEqual({
      firecrawlApiKey: "fc",
      exaApiKey: "exa",
    });
  });

  it("fails clearly when neither provider is configured", async () => {
    await expect(withWebResearchFallback({
      firecrawlApiKey: null,
      exaApiKey: null,
      firecrawl: async () => "unused",
      exa: async () => "unused",
    })).rejects.toThrow("No web research provider configured");
  });
});
