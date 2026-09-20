import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRfqEmail, getAgentMailInbox, normalizeMailbox, resolveAgentMail, sendAgentMailMessage } from "./agentmail";

afterEach(() => vi.unstubAllGlobals());

describe("resolveAgentMail", () => {
  it("resolves key and default inbox", () => {
    const config = resolveAgentMail({ AGENTMAIL_API_KEY: "am_test", AGENTMAIL_INBOX: "ops@example.test" });
    expect(config.apiKey).toBe("am_test");
    expect(config.inboxId).toBe("ops@example.test");
  });

  it("is null-keyed without configuration", () => {
    expect(resolveAgentMail({}).apiKey).toBeNull();
  });
});

describe("normalizeMailbox", () => {
  it("normalizes a mailbox with or without a display name", () => {
    expect(normalizeMailbox("Supplier <Sales@Example.com>")).toBe("sales@example.com");
    expect(normalizeMailbox(" SALES@example.com ")).toBe("sales@example.com");
  });

  it("keeps a substring-spoofed mailbox distinct and rejects malformed values", () => {
    expect(normalizeMailbox("sales@example.com.attacker.test")).not.toBe(normalizeMailbox("sales@example.com"));
    expect(normalizeMailbox("Supplier sales@example.com")).toBeNull();
    expect(normalizeMailbox(null)).toBeNull();
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
    expect(text).not.toContain("demo");
  });
});

describe("durable dispatch markers", () => {
  it("writes a dispatch marker and can reconcile the provider message", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ message_id: "message-1", thread_id: "thread-1" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const config = resolveAgentMail({ AGENTMAIL_API_KEY: "test", AGENTMAIL_INBOX: "inbox@example.test" });

    await sendAgentMailMessage(config, "supplier@example.test", "RFQ", "Body", 1000, undefined, "rfq-one");
    expect(fetchMock.mock.calls[0][1].headers["Idempotency-Key"]).toBe("rfq-one");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).headers).toEqual({ "X-ReliefGrid-Dispatch": "rfq-one" });
  });

  it("resolves the configured shared inbox without creating another provider resource", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ inbox_id: "shared-inbox", email: "shared@example.test" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const config = resolveAgentMail({ AGENTMAIL_API_KEY: "test", AGENTMAIL_INBOX: "shared-inbox" });

    await expect(getAgentMailInbox(config, 1000)).resolves.toMatchObject({
      inboxId: "shared-inbox",
      email: "shared@example.test",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].method).toBeUndefined();
  });
});
