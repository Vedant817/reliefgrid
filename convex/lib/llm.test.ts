import { describe, expect, it } from "vitest";
import {
  buildExtractionPrompt,
  listLlmProviders,
  parseExtractionJson,
  resolveLlmProvider,
  withLlmFallback,
} from "./llm";

describe("resolveLlmProvider", () => {
  it("prefers OpenAI when both keys are present", () => {
    const config = resolveLlmProvider({ OPENAI_API_KEY: "sk-test", GROQ_API_KEY: "gsk-test" });
    expect(config.kind).toBe("openai");
    expect(config.baseUrl).toBe("https://api.openai.com/v1");
    expect(config.model).toBe("gpt-4o-mini");
  });

  it("uses Groq when only its key is present", () => {
    const config = resolveLlmProvider({ GROQ_API_KEY: "gsk-test" });
    expect(config.kind).toBe("groq");
    expect(config.baseUrl).toBe("https://api.groq.com/openai/v1");
    expect(config.model).toBe("openai/gpt-oss-120b");
  });

  it("lists OpenAI then Groq for live fallback", () => {
    expect(listLlmProviders({ OPENAI_API_KEY: "sk-test", GROQ_API_KEY: "gsk-test" }).map((item) => item.kind))
      .toEqual(["openai", "groq"]);
  });

  it("reports an unconfigured provider with no keys", () => {
    expect(resolveLlmProvider({}).kind).toBe("unconfigured");
  });

  it("falls back to Groq when OpenAI throws", async () => {
    const result = await withLlmFallback({
      providers: listLlmProviders({ OPENAI_API_KEY: "sk-test", GROQ_API_KEY: "gsk-test" }),
      run: async (config) => {
        if (config.kind === "openai") throw new Error("OpenAI HTTP 429");
        return `ok:${config.kind}`;
      },
    });
    expect(result.value).toBe("ok:groq");
    expect(result.provider.kind).toBe("groq");
    expect(result.failures).toEqual([{ provider: "openai", error: "OpenAI HTTP 429" }]);
  });
});

describe("parseExtractionJson", () => {
  it("accepts a valid model reply, including fenced code", () => {
    const parsed = parseExtractionJson(
      '```json\n{"qty": 70, "unitPriceCents": 1100, "arrivalAtIso": "2026-09-05T16:00:00-04:00", "certStatus": "verified", "language": "en", "conditions": [], "confidence": 0.9, "fieldConfidences": {"qty": 0.9, "price": 0.9, "arrival": 0.8, "cert": 0.9}}\n```',
    );
    expect(parsed?.qty).toBe(70);
    expect(parsed?.arrivalAtIso).toBe("2026-09-05T16:00:00-04:00");
  });

  it("nulls out guessed or invalid fields instead of hallucinating", () => {
    const parsed = parseExtractionJson(
      '{"qty": -3, "unitPriceCents": 0, "arrivalAtIso": "NEXT_WEEK", "certStatus": "maybe", "language": "fr", "conditions": "none", "confidence": 99, "fieldConfidences": {}}',
    );
    expect(parsed?.qty).toBeNull();
    expect(parsed?.unitPriceCents).toBeNull();
    expect(parsed?.arrivalAtIso).toBeNull();
    expect(parsed?.certStatus).toBe("needs_review");
    expect(parsed?.language).toBe("en");
    expect(parsed?.conditions).toEqual([]);
    expect(parsed?.confidence).toBe(1);
  });

  it("returns null for unparseable output so callers reject it", () => {
    expect(parseExtractionJson("sorry, I cannot do that")).toBeNull();
  });

  it("builds a prompt that forbids guessing", () => {
    const prompt = buildExtractionPrompt("We can deliver 70 filters.");
    expect(prompt.system).toContain("Never guess");
    expect(prompt.user).toContain("70 filters");
  });
});
