import { describe, expect, test } from "vitest";
import { awardDispatchMessage } from "./awards";

describe("awardDispatchMessage", () => {
  test("does not report a failed AgentMail dispatch as success", () => {
    expect(awardDispatchMessage({ sent: 0, skipped: 0, failed: 1 })).toBe(
      "Plan approved, but 1 supplier notice failed",
    );
  });

  test("reports confirmed sends", () => {
    expect(awardDispatchMessage({ sent: 2, skipped: 0, failed: 0 })).toBe(
      "Plan approved — 2 supplier notices sent",
    );
  });
});
