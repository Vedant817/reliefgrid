import { describe, expect, it } from "vitest";
import { buildExtractionPrompt, parseExtractionJson, resolveLlmProvider } from "./llm";

describe("resolveLlmProvider", () => {
  it("prefers Groq when its key is present", () => {
    expect(resolveLlmProvider({ GROQ_API_KEY: "gsk-test" }).kind).toBe("groq");
  });

  it("uses OpenAI when only its key is present", () => {
    const config = resolveLlmProvider({ OPENAI_API_KEY: "sk-test" });
    expect(config.kind).toBe("openai");
    expect(config.baseUrl).toBe("https://api.openai.com/v1");
  });

  it("falls back to mock with no keys", () => {
    expect(resolveLlmProvider({}).kind).toBe("mock");
  });
});

describe("parseExtractionJson", () => {
  it("accepts a valid model reply, including fenced code", () => {
    const parsed = parseExtractionJson(
      '```json\n{"qty": 70, "unitPriceCents": 1100, "arrivalHint": "TODAY_4PM", "certStatus": "verified", "language": "en", "conditions": [], "confidence": 0.9, "fieldConfidences": {"qty": 0.9, "price": 0.9, "arrival": 0.8, "cert": 0.9}}\n```',
    );
    expect(parsed?.qty).toBe(70);
    expect(parsed?.arrivalHint).toBe("TODAY_4PM");
  });

  it("nulls out guessed or invalid fields instead of hallucinating", () => {
    const parsed = parseExtractionJson(
      '{"qty": -3, "unitPriceCents": 0, "arrivalHint": "NEXT_WEEK", "certStatus": "maybe", "language": "fr", "conditions": "none", "confidence": 99, "fieldConfidences": {}}',
    );
    expect(parsed?.qty).toBeNull();
    expect(parsed?.unitPriceCents).toBeNull();
    expect(parsed?.arrivalHint).toBe("UNKNOWN");
    expect(parsed?.certStatus).toBe("needs_review");
    expect(parsed?.language).toBe("en");
    expect(parsed?.conditions).toEqual([]);
    expect(parsed?.confidence).toBe(1);
  });

  it("returns null for unparseable output so callers use the mock", () => {
    expect(parseExtractionJson("sorry, I cannot do that")).toBeNull();
  });

  it("builds a prompt that forbids guessing", () => {
    const prompt = buildExtractionPrompt("We can deliver 70 filters.");
    expect(prompt.system).toContain("Never guess");
    expect(prompt.user).toContain("70 filters");
  });
});
