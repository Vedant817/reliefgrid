import { describe, expect, it, vi } from "vitest";
import { resolveExa, scrapeViaExa, searchViaExa } from "./exa";

describe("Exa web research client", () => {
  it("resolves configuration without exposing or inventing a key", () => {
    expect(resolveExa({ EXA_API_KEY: "exa-test" }).apiKey).toBe("exa-test");
    expect(resolveExa({}).apiKey).toBeNull();
  });

  it("normalizes search results and authenticates with x-api-key", async () => {
    let receivedUrl = "";
    let receivedInit: RequestInit | undefined;
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      receivedUrl = String(input);
      receivedInit = init;
      return new Response(JSON.stringify({
        requestId: "exa-search-1",
        results: [
          { title: "Supplier One", url: "https://supplier.example/item", highlights: ["Certified product supplier"] },
          { title: "Duplicate", url: "https://supplier.example/item", highlights: ["duplicate"] },
        ],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const result = await searchViaExa("certified filters", 5, { apiKey: "exa-test", fetchImpl });

    expect(result).toMatchObject({
      requestId: "exa-search-1",
      hits: [{ title: "Supplier One", url: "https://supplier.example/item", snippet: "Certified product supplier" }],
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(receivedUrl).toBe("https://api.exa.ai/search");
    expect(new Headers(receivedInit?.headers).get("x-api-key")).toBe("exa-test");
    expect(JSON.parse(String(receivedInit?.body))).toMatchObject({ query: "certified filters", numResults: 5 });
  });

  it("gets fresh page text for evidence matching", async () => {
    let receivedInit: RequestInit | undefined;
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      receivedInit = init;
      return new Response(JSON.stringify({
        requestId: "exa-content-1",
        results: [{ title: "Official registry", url: "https://agency.gov/model", text: "Model NF-53 is certified." }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const result = await scrapeViaExa("https://agency.gov/model", { apiKey: "exa-test", fetchImpl });

    expect(result).toMatchObject({
      requestId: "exa-content-1",
      title: "Official registry",
      quote: "Model NF-53 is certified.",
    });
    expect(JSON.parse(String(receivedInit?.body))).toEqual({
      urls: ["https://agency.gov/model"],
      text: true,
      maxAgeHours: 0,
    });
  });

  it("surfaces provider status and error detail", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "Payment required" }), {
      status: 402,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(searchViaExa("query", 5, { apiKey: "exa-test", fetchImpl }))
      .rejects.toThrow("Exa request failed (402): Payment required");
  });
});
