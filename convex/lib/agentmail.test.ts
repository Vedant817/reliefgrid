import { describe, expect, it } from "vitest";
import { buildRfqEmail, resolveAgentMail } from "./agentmail";

describe("resolveAgentMail", () => {
  it("resolves key and default inbox", () => {
    const config = resolveAgentMail({ AGENTMAIL_API_KEY: "am_test" });
    expect(config.apiKey).toBe("am_test");
    expect(config.inboxId).toContain("@agentmail.to");
  });

  it("is null-keyed without configuration", () => {
    expect(resolveAgentMail({}).apiKey).toBeNull();
  });
});

describe("buildRfqEmail", () => {
  it("includes qty, item, deadline, budget, and cert", () => {
    const { subject, text } = buildRfqEmail(
      { item: "Portable water filters", qty: 100, deadlineAt: 1788470000000, budgetCents: 120000, certRequired: "NSF/ANSI 53" },
      "Apex",
    );
    expect(subject).toContain("100x");
    expect(text).toContain("Apex");
    expect(text).toContain("NSF/ANSI 53");
    expect(text).toContain("controlled demo");
  });
});
