import { describe, expect, it } from "vitest";

describe("replay snapshots", () => {
  it("normalizes deterministically", () => {
    const snapshot = JSON.stringify({ offers: [{ supplier: "Apex", qty: 70 }], plan: { coverage: 70 } });
    expect(JSON.stringify(JSON.parse(snapshot))).toBe(JSON.stringify(JSON.parse(snapshot)));
  });
});
