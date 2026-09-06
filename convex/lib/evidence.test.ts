import { describe, expect, test } from "vitest";
import {
  RECALL_LANGUAGE,
  authorityForHostname,
  containsExactPhrase,
  isAuthoritativeHostname,
  normalized,
} from "./evidence";

describe("evidence matchers", () => {
  test("normalization lowercases and strips punctuation", () => {
    expect(normalized("NSF/ANSI 53")).toBe("nsf ansi 53");
  });

  test("exact phrases match on word boundaries only", () => {
    expect(containsExactPhrase(normalized("model nf-53 lot a17"), "NF-53")).toBe(true);
    expect(containsExactPhrase(normalized("model nf-530 lot"), "NF-53")).toBe(false);
    expect(containsExactPhrase(normalized("anything"), "")).toBe(false);
  });

  test("authority follows the .gov / NSF / WHO rule", () => {
    expect(authorityForHostname("www.cpsc.gov")).toBe("authoritative");
    expect(authorityForHostname("nsf.org")).toBe("authoritative");
    expect(authorityForHostname("example.com")).toBe("supporting");
    expect(isAuthoritativeHostname("www.fda.gov")).toBe(true);
    expect(isAuthoritativeHostname("recall.example.com")).toBe(false);
  });

  test("recall language covers every historically used pattern", () => {
    for (const phrase of [
      "recall active",
      "has been recalled",
      "was recalled yesterday",
      "recall notice",
      "stop using this product",
      "stop distribution pending review",
      "stop sale immediately",
      "do not use",
      "product recall",
    ]) {
      expect(RECALL_LANGUAGE.test(normalized(phrase))).toBe(true);
    }
    expect(RECALL_LANGUAGE.test(normalized("no safety notices for this model"))).toBe(false);
  });
});
