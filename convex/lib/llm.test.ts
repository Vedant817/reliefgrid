import { describe, expect, it } from "vitest";
import {
  buildExtractionPrompt,
  listLlmProviders,
  parseExtractionJson,
  resolveLlmProvider,
  withExtractionFallback,
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

  it("falls back to Groq when OpenAI returns malformed extraction JSON", async () => {
    const result = await withExtractionFallback({
      providers: listLlmProviders({ OPENAI_API_KEY: "sk-test", GROQ_API_KEY: "gsk-test" }),
      run: async (config) => ({
        requestId: config.kind,
        latencyMs: 1,
        content: config.kind === "openai"
          ? "not json"
          : '{"qty":70,"unitPriceCents":1100,"arrivalAtIso":"2026-09-24","certStatus":"unverified","language":"en","conditions":[],"confidence":0.9,"fieldConfidences":{"qty":0.9,"price":0.9,"arrival":0.9,"cert":1}}',
      }),
    });
    expect(result.provider.kind).toBe("groq");
    expect(result.value.offer.arrivalAtIso).toBe("2026-09-24");
    expect(result.failures).toEqual([{ provider: "openai", error: "unparseable model output" }]);
  });

  it("retries malformed Groq output once without weakening validation", async () => {
    let attempts = 0;
    const result = await withExtractionFallback({
      providers: listLlmProviders({ GROQ_API_KEY: "gsk-test" }),
      run: async () => {
        attempts += 1;
        return { requestId: "first", latencyMs: 1, content: "not json" };
      },
      retry: async () => {
        attempts += 1;
        return {
          requestId: "retry",
          latencyMs: 1,
          content: '{"qty":100,"unitPriceCents":1275,"arrivalAtIso":"2026-09-25","certStatus":"unverified","language":"en","conditions":[],"confidence":0.99,"fieldConfidences":{"qty":0.99,"price":0.99,"arrival":0.99,"cert":0.99}}',
        };
      },
    });
    expect(attempts).toBe(2);
    expect(result.provider.kind).toBe("groq");
    expect(result.value.requestId).toBe("retry");
    expect(result.value.offer.qty).toBe(100);
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

  it("accepts ordinary date-only delivery promises", () => {
    const parsed = parseExtractionJson(
      '{"qty":100,"unitPriceCents":900,"arrivalAtIso":"2026-09-24","certStatus":"unverified","language":"en","conditions":[],"confidence":0.95,"fieldConfidences":{"qty":0.95,"price":0.95,"arrival":0.95,"cert":1}}',
    );
    expect(parsed?.arrivalAtIso).toBe("2026-09-24");
  });

  it("rejects ambiguous offset-free date-times", () => {
    const parsed = parseExtractionJson(
      '{"qty":100,"unitPriceCents":900,"arrivalAtIso":"2026-09-24T16:00:00","certStatus":"unverified","language":"en","conditions":[],"confidence":0.95,"fieldConfidences":{"qty":0.95,"price":0.95,"arrival":0.95,"cert":1}}',
    );
    expect(parsed?.arrivalAtIso).toBeNull();
  });

  it("rejects schema-invalid provider output instead of suppressing fallback", () => {
    expect(parseExtractionJson(
      '{"qty": -3, "unitPriceCents": 0, "arrivalAtIso": "NEXT_WEEK", "certStatus": "maybe", "language": "fr", "conditions": "none", "confidence": 99, "fieldConfidences": {}}',
    )).toBeNull();
    expect(parseExtractionJson("{}")).toBeNull();
  });

  it("returns null for unparseable output so callers reject it", () => {
    expect(parseExtractionJson("sorry, I cannot do that")).toBeNull();
  });

  it("builds a prompt that forbids guessing", () => {
    const prompt = buildExtractionPrompt("We can deliver 70 filters.", "2026-09-20T12:00:00.000Z", "Asia/Kolkata");
    expect(prompt.system).toContain("Never guess");
    expect(prompt.system).toContain("end-of-day");
    expect(prompt.system).toContain("Asia/Kolkata");
    expect(prompt.user).toContain("70 filters");
  });
});
