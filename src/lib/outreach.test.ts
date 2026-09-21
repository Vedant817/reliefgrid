import { describe, expect, test, vi } from "vitest";
import {
  awaitingReplyThreads,
  countVerifiedOffers,
  flowStepAvailable,
  flowStepForWorkspace,
  nextStepForWorkspace,
  sendOutreachForNeed,
} from "./outreach";

function deps(overrides: Record<string, unknown> = {}) {
  return {
    ensureInbox: vi.fn(async (_needId: string) => undefined),
    createThreads: vi.fn(async (_needId: string, _supplierIds: string[]) => [{ _id: "thread-1" }]),
    sendRfq: vi.fn(async (_threadId: string) => ({ deduped: false })),
    ...overrides,
  };
}

describe("sendOutreachForNeed", () => {
  test("sends one RFQ per thread in inbox → threads → send order", async () => {
    const d = deps({ createThreads: vi.fn(async () => [{ _id: "t1" }, { _id: "t2" }]) });
    const result = await sendOutreachForNeed(d, "need-1", ["s1", "s2"]);
    expect(result).toEqual({ sent: 2, deduped: 0, errors: [] });
    expect(d.ensureInbox).toHaveBeenCalledWith("need-1");
    expect(d.createThreads).toHaveBeenCalledWith("need-1", ["s1", "s2"]);
    expect(d.sendRfq).toHaveBeenCalledTimes(2);
  });

  test("an inbox failure stops before threads and reports it", async () => {
    const d = deps({ ensureInbox: vi.fn(async () => { throw new Error("no key"); }) });
    expect(await sendOutreachForNeed(d, "need-1", ["s1"])).toEqual({ sent: 0, deduped: 0, errors: ["Could not prepare the inbox"] });
    expect(d.createThreads).not.toHaveBeenCalled();
  });

  test("per-thread failures are collected while siblings still send", async () => {
    const d = deps({
      createThreads: vi.fn(async () => [{ _id: "t1" }, { _id: "t2" }]),
      sendRfq: vi.fn(async (id: string) => {
        if (id === "t1") throw new Error("provider 429");
        return { deduped: false };
      }),
    });
    expect(await sendOutreachForNeed(d, "need-1", ["s1", "s2"])).toEqual({ sent: 1, deduped: 0, errors: ["Could not send RFQ"] });
  });

  test("already-sent threads count as deduped and empty rows report it", async () => {
    const d = deps({ sendRfq: vi.fn(async () => ({ deduped: true })) });
    expect(await sendOutreachForNeed(d, "need-1", ["s1"])).toEqual({ sent: 0, deduped: 1, errors: [] });
    const empty = deps({ createThreads: vi.fn(async () => []) });
    expect(await sendOutreachForNeed(empty, "need-1", ["s1"])).toEqual({
      sent: 0, deduped: 0, errors: ["Could not create supplier thread"],
    });
  });
});

describe("workspace derivations", () => {
  test("verified offers count exact source-check matches", () => {
    const offers = [{ _id: "a" }, { _id: "b" }] as Array<{ _id: string }>;
    const checks = [{ offerId: "a", status: "verified" }, { offerId: "b", status: "needs_review" }];
    expect(countVerifiedOffers(offers, checks)).toBe(1);
  });

  test("next step walks the pipeline in order", () => {
    const base = { hasNeed: true, supplierCount: 1, threadCount: 1, sentThreadCount: 1, offerCount: 1, verifiedCount: 1, requiresEvidence: true, hasPlan: true, planApproved: false };
    expect(nextStepForWorkspace({ ...base, hasNeed: false })).toMatch(/requirement/);
    expect(nextStepForWorkspace({ ...base, supplierCount: 0, threadCount: 0, sentThreadCount: 0, offerCount: 0 })).toMatch(/saved vendor/);
    expect(nextStepForWorkspace({ ...base, sentThreadCount: 0, offerCount: 0 })).toMatch(/approve supplier outreach/);
    expect(nextStepForWorkspace({ ...base, offerCount: 0 })).toMatch(/paste a quote/);
    expect(nextStepForWorkspace({ ...base, verifiedCount: 0 })).toMatch(/evidence/);
    expect(nextStepForWorkspace({ ...base, verifiedCount: 0, requiresEvidence: false })).toMatch(/approve the plan/);
    expect(nextStepForWorkspace({ ...base, hasPlan: false })).toMatch(/recommendation/);
    expect(nextStepForWorkspace(base)).toMatch(/approve the plan/);
    expect(nextStepForWorkspace({ ...base, planApproved: true })).toMatch(/Done/);
  });

  test("flow step follows the same pipeline as next-step copy", () => {
    const base = { hasNeed: true, supplierCount: 1, threadCount: 1, sentThreadCount: 1, offerCount: 1, verifiedCount: 1, requiresEvidence: true, hasPlan: true, planApproved: false };
    expect(flowStepForWorkspace({ ...base, hasNeed: false })).toBe("requirement");
    expect(flowStepForWorkspace({ ...base, supplierCount: 0, threadCount: 0, offerCount: 0 })).toBe("suppliers");
    expect(flowStepForWorkspace({ ...base, offerCount: 0 })).toBe("quotes");
    expect(flowStepForWorkspace({ ...base, verifiedCount: 0 })).toBe("quotes");
    expect(flowStepForWorkspace({ ...base, verifiedCount: 0, requiresEvidence: false })).toBe("decide");
    expect(flowStepForWorkspace({ ...base, hasPlan: false })).toBe("decide");
    expect(flowStepForWorkspace(base)).toBe("decide");
    expect(flowStepForWorkspace({ ...base, planApproved: true })).toBe("decide");
  });

  test("quotes are available after a supplier is added, decide after eligible quotes", () => {
    const none = { hasNeed: false, supplierCount: 0, threadCount: 0, sentThreadCount: 0, offerCount: 0, verifiedCount: 0, requiresEvidence: false, hasPlan: false, planApproved: false };
    expect(flowStepAvailable("requirement", none)).toBe(true);
    expect(flowStepAvailable("suppliers", none)).toBe(false);
    expect(flowStepAvailable("quotes", { ...none, hasNeed: true })).toBe(false);
    expect(flowStepAvailable("quotes", { ...none, hasNeed: true, supplierCount: 1 })).toBe(false);
    expect(flowStepAvailable("quotes", { ...none, hasNeed: true, supplierCount: 1, threadCount: 1 })).toBe(true);
    expect(flowStepAvailable("decide", { ...none, hasNeed: true, offerCount: 1 })).toBe(true);
    expect(flowStepAvailable("decide", { ...none, hasNeed: true, offerCount: 1, requiresEvidence: true, verifiedCount: 0 })).toBe(false);
  });

  test("awaiting replies means sent with a provider thread", () => {
    const threads = [
      { status: "sent", agentmailMessageId: "m1" },
      { status: "sent" },
      { status: "replied", agentmailMessageId: "m2" },
    ];
    expect(awaitingReplyThreads(threads)).toHaveLength(1);
  });
});
