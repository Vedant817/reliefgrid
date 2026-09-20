import { describe, expect, test, vi } from "vitest";
import {
  awaitingReplyThreads,
  countVerifiedOffers,
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
    expect(await sendOutreachForNeed(d, "need-1", ["s1"])).toEqual({ sent: 0, deduped: 0, errors: ["no key"] });
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
    expect(await sendOutreachForNeed(d, "need-1", ["s1", "s2"])).toEqual({ sent: 1, deduped: 0, errors: ["provider 429"] });
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
    const base = { hasNeed: true, threadCount: 1, offerCount: 1, verifiedCount: 1, requiresEvidence: true, hasPlan: true, planApproved: false };
    expect(nextStepForWorkspace({ ...base, hasNeed: false })).toMatch(/requirement/);
    expect(nextStepForWorkspace({ ...base, threadCount: 0 })).toMatch(/suppliers/);
    expect(nextStepForWorkspace({ ...base, offerCount: 0 })).toMatch(/replies/);
    expect(nextStepForWorkspace({ ...base, verifiedCount: 0 })).toMatch(/evidence/);
    expect(nextStepForWorkspace({ ...base, verifiedCount: 0, requiresEvidence: false })).toMatch(/approve the plan/);
    expect(nextStepForWorkspace({ ...base, hasPlan: false })).toMatch(/Compute/);
    expect(nextStepForWorkspace(base)).toMatch(/approve the plan/);
    expect(nextStepForWorkspace({ ...base, planApproved: true })).toMatch(/Done/);
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
