import { describe, expect, test } from "vitest";
import { hasActiveRecall, resolveCertStatus } from "./certStatus";

describe("resolveCertStatus", () => {
  test("an active recall fails everything", () => {
    expect(resolveCertStatus({ status: "verified", type: "cert", sourceAuthority: "authoritative", matched: true }, { activeRecall: true })).toBe("failed");
  });

  test("an authoritative matched failed recall fails the offer", () => {
    expect(resolveCertStatus({ status: "failed", type: "recall", sourceAuthority: "authoritative", matched: true }, { activeRecall: false })).toBe("failed");
  });

  test("a non-authoritative or unmatched recall carries no verdict", () => {
    expect(resolveCertStatus({ status: "failed", type: "recall", sourceAuthority: "supporting", matched: true }, { activeRecall: false })).toBeNull();
    expect(resolveCertStatus({ status: "failed", type: "recall", sourceAuthority: "authoritative", matched: false }, { activeRecall: false })).toBeNull();
    expect(resolveCertStatus({ status: "needs_review", type: "recall", sourceAuthority: "authoritative", matched: true }, { activeRecall: false })).toBeNull();
  });

  test("cert grades pass through when no recall is active", () => {
    expect(resolveCertStatus({ status: "verified", type: "cert" }, { activeRecall: false })).toBe("verified");
    expect(resolveCertStatus({ status: "failed", type: "cert" }, { activeRecall: false })).toBe("failed");
    expect(resolveCertStatus({ status: "needs_review", type: "cert" }, { activeRecall: false })).toBe("needs_review");
  });

  test("other evidence types carry no verdict", () => {
    expect(resolveCertStatus({ status: "verified", type: "spec", sourceAuthority: "authoritative", matched: true }, { activeRecall: false })).toBeNull();
  });

  test("hasActiveRecall is exported for the seam", () => {
    expect(typeof hasActiveRecall).toBe("function");
  });
});
