import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import { buildDriftSnapshot } from "./lib/drift";
import schema from "./schema";
import aggregate from "@convex-dev/aggregate/test";

const modules = import.meta.glob("./**/*.*s");
const future = () => Date.now() + 6 * 3600 * 1000;

function makeT() {
  const t = convexTest(schema, modules);
  aggregate.register(t);
  return t;
}

function asUser(t: any, subject = "test-user", name = "Test User") {
  return t.withIdentity({ subject, issuer: "https://tests.reliefgrid.test", name });
}

async function seedSuppliers(t: any) {
  const existing: any[] = await t.query(api.suppliers.listSuppliers, {});
  if (existing.length > 0) return existing;
  for (let index = 1; index <= 5; index++) {
    await t.mutation(api.suppliers.upsertSupplier, {
      name: `Test Supplier ${index}`,
      contactEmail: `supplier${index}@vendor.example.org`,
      region: `Region ${index}`,
    });
  }
  return await t.query(api.suppliers.listSuppliers, {});
}

async function seedNeed(t: any, overrides: any = {}) {
  const incidentId = await t.mutation(api.incidents.createIncident, {
    title: "Test incident",
    deadlineAt: future(),
  });
  const needId = await t.mutation(api.needs.createNeed, {
    incidentId,
    item: "Filters",
    qty: 100,
    deadlineAt: future(),
    budgetCents: 120000,
    partialAllowed: true,
    ...overrides,
  });
  return { incidentId, needId };
}

describe("need validators", () => {
  test("rejects qty 0, negative budget, past deadline, empty item", async () => {
    const t = asUser(makeT());
    const incidentId = await t.mutation(api.incidents.createIncident, {
      title: "T",
      deadlineAt: future(),
    });
    await expect(
      t.mutation(api.needs.createNeed, {
        incidentId, item: "x", qty: 0, deadlineAt: future(), budgetCents: 100, partialAllowed: true,
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.needs.createNeed, {
        incidentId, item: "x", qty: 5, deadlineAt: future(), budgetCents: -1, partialAllowed: true,
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.needs.createNeed, {
        incidentId, item: "x", qty: 5, deadlineAt: Date.now() - 1000, budgetCents: 100, partialAllowed: true,
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.needs.createNeed, {
        incidentId, item: "  ", qty: 5, deadlineAt: future(), budgetCents: 100, partialAllowed: true,
      }),
    ).rejects.toThrow();
  });
});

describe("offer guards", () => {
  test("rejects negative price and divergent replays, dedups identical replays", async () => {
    const t = asUser(makeT());
    const { needId } = await seedNeed(t);
    const suppliers: any[] = await seedSuppliers(t);
    const supplierId = suppliers[0]._id;
    const base = {
      needId, supplierId, qty: 60, unitPriceCents: 1100, arrivalAt: future(),
      certStatus: "verified", conditions: [], confidence: 0.97,
      rawEmailId: "t-1", rawBody: "60 filters", language: "en",
    };
    await expect(t.mutation(internal.offers.upsertOfferVersion, { ...base, unitPriceCents: -5 })).rejects.toThrow();
    const id1: string = await t.mutation(internal.offers.upsertOfferVersion, base);
    await expect(
      t.mutation(internal.offers.upsertOfferVersion, { ...base, qty: 70 }),
    ).rejects.toThrow(/divergent/);
    const id2: string = await t.mutation(internal.offers.upsertOfferVersion, base);
    expect(id2).toBe(id1);
  });
});

describe("approval state machine", () => {
  test("guards approver, double-approve, retired plans, and enforces single award", async () => {
    const raw = makeT();
    const t = asUser(raw);
    const { needId } = await seedNeed(t);
    const suppliers: any[] = await seedSuppliers(t);
    await t.mutation(internal.offers.upsertOfferVersion, {
      needId, supplierId: suppliers[0]._id, qty: 100, unitPriceCents: 1000, arrivalAt: Date.now() + 3600000,
      certStatus: "verified", conditions: [], confidence: 0.97,
      rawEmailId: "t-a", rawBody: "100 units", language: "en",
    });
    const first: any = await t.mutation(api.allocations.computeAllocation, { needId });
    expect(first.planId).not.toBeNull();
    await expect(raw.mutation(api.allocations.approvePlan, { planId: first.planId })).rejects.toThrow(/Authentication/);
    await t.mutation(api.allocations.approvePlan, { planId: first.planId });
    await expect(
      t.mutation(api.allocations.approvePlan, { planId: first.planId }),
    ).rejects.toThrow(/proposed/);
    // Identical recompute dedups instead of minting a duplicate.
    const again: any = await t.mutation(api.allocations.computeAllocation, { needId });
    expect(again.planId).toBe(first.planId);
    // New terms supersede; approving the new plan retires the old award.
    await t.mutation(internal.offers.upsertOfferVersion, {
      needId, supplierId: suppliers[1]._id, qty: 100, unitPriceCents: 900, arrivalAt: Date.now() + 3600000,
      certStatus: "verified", conditions: [], confidence: 0.95,
      rawEmailId: "t-b", rawBody: "100 units cheap", language: "en",
    });
    const second: any = await t.mutation(api.allocations.computeAllocation, { needId });
    expect(second.planId).not.toBe(first.planId);
    await t.mutation(api.allocations.approvePlan, { planId: second.planId });
    const plans: any[] = await t.query(api.allocations.listAllocationPlans, { needId });
    const statuses = Object.fromEntries(plans.map((p) => [p._id, p.status]));
    expect(statuses[first.planId]).toBe("superseded");
    expect(statuses[second.planId]).toBe("approved");
    await expect(
      t.mutation(api.allocations.approvePlan, { planId: first.planId }),
    ).rejects.toThrow(/proposed/);
  });

  test("server identity wins over the client-supplied approver name", async () => {
    const raw = makeT();
    const t = asUser(raw, "user_server_1", "Server User");
    const { needId } = await seedNeed(t);
    const suppliers: any[] = await seedSuppliers(t);
    await t.mutation(internal.offers.upsertOfferVersion, {
      needId, supplierId: suppliers[0]._id, qty: 100, unitPriceCents: 1000, arrivalAt: Date.now() + 3600000,
      certStatus: "verified", conditions: [], confidence: 0.97,
      rawEmailId: "t-c", rawBody: "100 units", language: "en",
    });
    const plan: any = await t.mutation(api.allocations.computeAllocation, { needId });
    await t.mutation(api.allocations.approvePlan, { planId: plan.planId });
    const plans: any[] = await t.query(api.allocations.listAllocationPlans, { needId });
    expect(plans[0].approval.approvedBy).toBe("Server User");
  });

  test("empty need mints no plan", async () => {
    const t = asUser(makeT());
    const { needId } = await seedNeed(t);
    const result: any = await t.mutation(api.allocations.computeAllocation, { needId });
    expect(result.planId).toBeNull();
    expect(result.feasible).toBe(false);
  });
});

describe("internal thread state", () => {
  test("rejects unknown statuses", async () => {
    const t = asUser(makeT());
    const { needId } = await seedNeed(t);
    const suppliers: any[] = await seedSuppliers(t);
    await t.mutation(api.rfq.createRfqThreadsForNeed, { needId, supplierIds: [suppliers[0]._id] });
    const threads: any[] = await t.query(api.rfq.listThreadsByNeed, { needId });
    await expect(
      t.mutation(internal.rfq.updateThreadStatus, { threadId: threads[0]._id, status: "hacked" as any }),
    ).rejects.toThrow();
  });
});

describe("authorization and decision integrity", () => {
  test("one authenticated user cannot read or mutate another user's incident graph", async () => {
    const raw = makeT();
    const owner = asUser(raw, "owner-a", "Owner A");
    const stranger = asUser(raw, "owner-b", "Owner B");
    const { incidentId, needId } = await seedNeed(owner);

    await expect(stranger.query(api.incidents.getIncident, { incidentId })).rejects.toThrow(/not found/i);
    await expect(stranger.query(api.needs.getNeed, { needId })).rejects.toThrow(/not found/i);
    await expect(stranger.mutation(api.allocations.computeAllocation, { needId })).rejects.toThrow(/not found/i);
  });

  test("partial coverage remains a shortfall and cannot be awarded", async () => {
    const t = asUser(makeT());
    const { needId } = await seedNeed(t, { qty: 100, budgetCents: 100000, partialAllowed: true });
    const suppliers: any[] = await seedSuppliers(t);
    await t.mutation(internal.offers.upsertOfferVersion, {
      needId, supplierId: suppliers[0]._id, qty: 40, unitPriceCents: 1000, arrivalAt: Date.now() + 60 * 60 * 1000,
      certStatus: "verified", conditions: [], confidence: 0.98,
      rawEmailId: "partial-1", rawBody: "40 units", language: "en",
    });
    const plan: any = await t.mutation(api.allocations.computeAllocation, { needId });
    expect(plan.feasible).toBe(false);
    expect(plan.shortfallQty).toBe(60);
    await expect(t.mutation(api.allocations.approvePlan, { planId: plan.planId })).rejects.toThrow(/incomplete plan/);
  });

  test("a supplier certification claim stays out of allocation until source verification promotes it", async () => {
    const t = asUser(makeT());
    const { needId } = await seedNeed(t, { certRequired: "NSF/ANSI 53" });
    const suppliers: any[] = await seedSuppliers(t);
    const offerId = await t.mutation(internal.offers.upsertOfferVersion, {
      needId, supplierId: suppliers[0]._id, qty: 100, unitPriceCents: 1000, arrivalAt: Date.now() + 60 * 60 * 1000,
      certStatus: "needs_review", conditions: [], confidence: 0.98,
      rawEmailId: "claim-1", rawBody: "Certified NSF/ANSI 53", language: "en",
    });
    const before: any = await t.mutation(api.allocations.computeAllocation, { needId });
    expect(before.totalQty).toBe(0);
    await t.mutation(internal.sourceChecks.addSourceCheck, {
      offerId,
      url: "https://www.nsf.org/example",
      quote: "NSF/ANSI 53",
      status: "verified",
      reason: "authoritative exact match",
      type: "cert",
      claim: "NSF/ANSI 53",
      sourceAuthority: "authoritative",
      contentHash: "test-hash",
      matched: true,
    });
    const after: any = await t.mutation(api.allocations.computeAllocation, { needId });
    expect(after.totalQty).toBe(100);
    expect(after.feasible).toBe(true);
  });

  test("rejects approval after evidence changes the plan inputs", async () => {
    const t = asUser(makeT());
    const { needId } = await seedNeed(t, { certRequired: "NSF/ANSI 53" });
    const suppliers: any[] = await seedSuppliers(t);
    const offerId = await t.mutation(internal.offers.upsertOfferVersion, {
      needId, supplierId: suppliers[0]._id, qty: 100, unitPriceCents: 1000, arrivalAt: Date.now() + 60 * 60 * 1000,
      certStatus: "verified", conditions: [], confidence: 0.98,
      rawEmailId: "stale-1", rawBody: "100 certified units", language: "en",
    });
    const plan: any = await t.mutation(api.allocations.computeAllocation, { needId });
    await t.mutation(internal.sourceChecks.addSourceCheck, {
      offerId,
      url: "https://www.nsf.org/recall",
      quote: "Recall active",
      status: "failed",
      reason: "authoritative conflict",
      type: "recall",
      sourceAuthority: "authoritative",
      matched: true,
    });
    await expect(t.mutation(api.allocations.approvePlan, { planId: plan.planId })).rejects.toThrow(/stale/i);
  });

  test("failed evidence is ineligible even when no certification is required", async () => {
    const t = asUser(makeT());
    const { needId } = await seedNeed(t);
    const suppliers: any[] = await seedSuppliers(t);
    await t.mutation(internal.offers.upsertOfferVersion, {
      needId, supplierId: suppliers[0]._id, qty: 100, unitPriceCents: 1000, arrivalAt: Date.now() + 60 * 60 * 1000,
      certStatus: "failed", conditions: [], confidence: 0.98,
      rawEmailId: "failed-1", rawBody: "100 units", language: "en",
    });
    const plan: any = await t.mutation(api.allocations.computeAllocation, { needId });
    expect(plan.totalQty).toBe(0);
    expect(plan.feasible).toBe(false);
  });

  test("a later certification check cannot erase an active authoritative recall", async () => {
    const t = asUser(makeT());
    const { needId } = await seedNeed(t, { certRequired: "NSF/ANSI 53" });
    const suppliers: any[] = await seedSuppliers(t);
    const offerId = await t.mutation(internal.offers.upsertOfferVersion, {
      needId, supplierId: suppliers[0]._id, qty: 100, unitPriceCents: 1000, arrivalAt: Date.now() + 60 * 60 * 1000,
      certStatus: "verified", conditions: [], confidence: 0.98,
      rawEmailId: "recall-1", rawBody: "100 certified units", language: "en",
    });
    await t.mutation(internal.sourceChecks.addSourceCheck, {
      offerId, url: "https://www.nsf.org/recall", quote: "Recall active for model", status: "failed",
      reason: "authoritative recall", type: "recall", sourceAuthority: "authoritative", matched: true,
    });
    await t.mutation(internal.sourceChecks.addSourceCheck, {
      offerId, url: "https://www.nsf.org/cert", quote: "NSF/ANSI 53", status: "verified",
      reason: "certification listing", type: "cert", sourceAuthority: "authoritative", matched: true,
    });
    await t.mutation(internal.offers.upsertOfferVersion, {
      needId, supplierId: suppliers[0]._id, qty: 100, unitPriceCents: 950, arrivalAt: Date.now() + 45 * 60 * 1000,
      certStatus: "needs_review", conditions: [], confidence: 0.99,
      rawEmailId: "recall-2", rawBody: "Updated quote for 100 units", language: "en",
    });
    const offers: any[] = await t.query(api.offers.listOffersByNeed, { needId });
    expect(offers[0].certStatus).toBe("failed");
  });

  test("provider history is isolated by owner", async () => {    const raw = makeT();
    const ownerA = asUser(raw, "provider-a", "Provider A");
    const ownerB = asUser(raw, "provider-b", "Provider B");
    await raw.mutation(internal.health.recordProviderRun, { provider: "firecrawl", operation: "a", status: "live", ownerId: "https://tests.reliefgrid.test|provider-a" });
    await raw.mutation(internal.health.recordProviderRun, { provider: "agentmail", operation: "b", status: "live", ownerId: "https://tests.reliefgrid.test|provider-b" });
    const runsA: any[] = await ownerA.query(api.health.listProviderRuns, {});
    const runsB: any[] = await ownerB.query(api.health.listProviderRuns, {});
    expect(runsA.map((run) => run.operation)).toEqual(["a"]);
    expect(runsB.map((run) => run.operation)).toEqual(["b"]);
  });

  test("need ownership lookup is scoped to the incident owner", async () => {
    const raw = makeT();
    const owner = asUser(raw, "recall-owner", "Recall Owner");
    const stranger = asUser(raw, "recall-stranger", "Recall Stranger");
    const { needId } = await seedNeed(owner);
    const access: any = await owner.query(internal.needs.getNeedOwnership, { needId });
    expect(access.ownerId).toContain("recall-owner");
    await expect(stranger.query(internal.needs.getNeedOwnership, { needId })).rejects.toThrow(/not found/i);
  });

  test("public recall invalidates every affected offer and drafts a hold notice", async () => {
    const t = asUser(makeT());
    const { needId } = await seedNeed(t, { certRequired: "NSF/ANSI 53", evidenceKey: "NF-53" });
    const suppliers: any[] = await seedSuppliers(t);
    for (const [index, supplier] of suppliers.slice(0, 2).entries()) {
      await t.mutation(internal.offers.upsertOfferVersion, {
        needId, supplierId: supplier._id, qty: 50, unitPriceCents: 1000, arrivalAt: Date.now() + 60 * 60 * 1000,
        certStatus: "verified", conditions: [], confidence: 0.97,
        rawEmailId: `public-${index}`, rawBody: "50 certified units", language: "en",
      });
    }
    const before: any[] = await t.query(api.offers.listOffersByNeed, { needId });
    expect(before).toHaveLength(2);
    const result: any = await t.mutation(internal.evidenceDrift.applyPublicRecall, {
      needId,
      offerIds: before.map((offer) => offer._id),
      sourceUrl: "https://www.cpsc.gov/Recalls/test-recall",
      quote: "RECALL ACTIVE: model NF-53 stop distribution",
      contentHash: "test-hash",
    });
    expect(result.invalidated).toBe(2);
    expect(result.totalQty).toBe(0);
    const after: any[] = await t.query(api.offers.listOffersByNeed, { needId });
    expect(after.every((offer) => offer.certStatus === "failed")).toBe(true);
    const state: any = await t.query(api.evidenceDrift.getEvidenceDriftState, { needId });
    expect(state.holdNotice?.status).toBe("draft");
    await expect(
      t.mutation(internal.evidenceDrift.applyPublicRecall, {
        needId,
        offerIds: before.map((offer) => offer._id),
        sourceUrl: "https://www.cpsc.gov/Recalls/test-recall",
        quote: "RECALL ACTIVE: model NF-53 stop distribution",
        contentHash: "test-hash",
      }),
    ).rejects.toThrow(/already invalidated/);
  });

  test("a failed RFQ send releases its claim instead of stranding the thread", async () => {
    const t = asUser(makeT());
    const { needId } = await seedNeed(t);
    const supplierId: string = await t.mutation(api.suppliers.upsertSupplier, {
      name: "Real Supplier", contactEmail: "quotes@example.org", region: "Test region",
    });
    await t.mutation(internal.inboxes.ensureInbox, { needId, inboxId: "inbox-test", email: "test@example.test" });
    await t.mutation(api.rfq.createRfqThreadsForNeed, { needId, supplierIds: [supplierId] });
    const threads: any[] = await t.query(api.rfq.listThreadsByNeed, { needId });
    const threadId = threads[0]._id;
    const claim: any = await t.mutation(internal.rfq.claimRfqSend, { threadId });
    expect(claim.reconcile).toBe(false);
    // A stale release is a no-op; the matching release returns the thread to pending.
    await t.mutation(internal.rfq.releaseFreshRfqClaim, { threadId, claimedAt: claim.claimedAt + 1 });
    expect((await t.query(api.rfq.listThreadsByNeed, { needId }))[0].status).toBe("sending");
    await t.mutation(internal.rfq.releaseFreshRfqClaim, { threadId, claimedAt: claim.claimedAt });
    expect((await t.query(api.rfq.listThreadsByNeed, { needId }))[0].status).toBe("pending");
  });

  test("failed clarification and hold-notice sends restore the previous state", async () => {
    const t = asUser(makeT());
    const { needId } = await seedNeed(t, { certRequired: "NSF/ANSI 53", evidenceKey: "NF-53" });
    const supplierId: string = await t.mutation(api.suppliers.upsertSupplier, {
      name: "Real Supplier", contactEmail: "quotes@example.org", region: "Test region",
    });
    await t.mutation(internal.inboxes.ensureInbox, { needId, inboxId: "inbox-test", email: "test@example.test" });
    await t.mutation(api.rfq.createRfqThreadsForNeed, { needId, supplierIds: [supplierId] });
    const threadId = (await t.query(api.rfq.listThreadsByNeed, { needId }))[0]._id;
    await t.mutation(internal.rfq.claimRfqSend, { threadId });
    await t.mutation(internal.rfq.recordAgentMailSend, {
      threadId, agentmailThreadId: "thread-test", agentmailMessageId: "message-test",
    });
    const clarification: any = await t.mutation(
      internal.rfq.claimClarificationSend, { threadId, dispatchKey: "dispatch-test" },
    );
    expect(clarification.reconcile).toBe(false);
    await t.mutation(
      internal.rfq.releaseFreshClarificationClaim, { threadId, dispatchKey: "wrong-key", claimedAt: clarification.claimedAt },
    );
    expect((await t.query(api.rfq.listThreadsByNeed, { needId }))[0].status).toBe("clarification_sending");
    await t.mutation(
      internal.rfq.releaseFreshClarificationClaim, { threadId, dispatchKey: "dispatch-test", claimedAt: clarification.claimedAt },
    );
    expect((await t.query(api.rfq.listThreadsByNeed, { needId }))[0].status).toBe("sent");

    const offerId: string = await t.mutation(internal.offers.upsertOfferVersion, {
      needId, supplierId, qty: 100, unitPriceCents: 1000, arrivalAt: Date.now() + 60 * 60 * 1000,
      certStatus: "verified", conditions: [], confidence: 0.98,
      rawEmailId: "hold-1", rawBody: "100 certified units", language: "en",
    });
    await t.mutation(internal.evidenceDrift.applyPublicRecall, {
      needId,
      offerIds: [offerId],
      sourceUrl: "https://www.cpsc.gov/Recalls/test-recall",
      quote: "RECALL ACTIVE: model NF-53 stop distribution",
      contentHash: "test-hash",
    });
    const state: any = await t.query(api.evidenceDrift.getEvidenceDriftState, { needId });
    expect(state.holdNotice?.status).toBe("draft");
    expect(state.canSendHoldNotice).toBe(true);
    const holdClaim: any = await t.mutation(internal.evidenceDrift.claimHoldNoticeSend, { noticeId: state.holdNotice._id });
    expect(holdClaim.reconcile).toBe(false);
    await t.mutation(internal.evidenceDrift.releaseFreshHoldNoticeClaim, { noticeId: state.holdNotice._id, claimedAt: holdClaim.claimedAt + 1 });
    expect((await t.query(api.evidenceDrift.getEvidenceDriftState, { needId })).holdNotice.status).toBe("sending");
    await t.mutation(internal.evidenceDrift.releaseFreshHoldNoticeClaim, { noticeId: state.holdNotice._id, claimedAt: holdClaim.claimedAt });
    expect((await t.query(api.evidenceDrift.getEvidenceDriftState, { needId })).holdNotice.status).toBe("draft");
  });

  test("reminders are limited to unanswered RFQs owned by the caller", async () => {
    const raw = makeT();
    const owner = asUser(raw, "reminder-owner", "Reminder Owner");
    const stranger = asUser(raw, "reminder-stranger", "Reminder Stranger");
    const { needId } = await seedNeed(owner);
    const supplierId: string = await owner.mutation(api.suppliers.upsertSupplier, {
      name: "Real Supplier", contactEmail: "quotes@example.org", region: "Test region",
    });
    await owner.mutation(internal.inboxes.ensureInbox, { needId, inboxId: "inbox-test", email: "test@example.test" });
    await owner.mutation(api.rfq.createRfqThreadsForNeed, { needId, supplierIds: [supplierId] });
    const threadId = (await owner.query(api.rfq.listThreadsByNeed, { needId }))[0]._id;
    await owner.mutation(internal.rfq.claimRfqSend, { threadId });
    await owner.mutation(internal.rfq.recordAgentMailSend, {
      threadId, agentmailThreadId: "thread-test", agentmailMessageId: "message-test",
    });
    const detail: any = await owner.query(internal.rfq.getThreadForReminder, { threadId });
    expect(detail.thread._id).toBe(threadId);
    await expect(stranger.query(internal.rfq.getThreadForReminder, { threadId })).rejects.toThrow(/not found/i);
    await owner.mutation(internal.rfq.updateThreadStatus, { threadId, status: "replied" });
    await expect(owner.query(internal.rfq.getThreadForReminder, { threadId })).rejects.toThrow(/unanswered/);
  });

  test("basket summary reports per-need coverage within one incident", async () => {
    const raw = makeT();
    const owner = asUser(raw, "basket-owner", "Basket Owner");
    const stranger = asUser(raw, "basket-stranger", "Basket Stranger");
    const { incidentId, needId } = await seedNeed(owner, { qty: 100 });
    const suppliers: any[] = await seedSuppliers(owner);
    await owner.mutation(internal.offers.upsertOfferVersion, {
      needId, supplierId: suppliers[0]._id, qty: 100, unitPriceCents: 1000, arrivalAt: Date.now() + 60 * 60 * 1000,
      certStatus: "verified", conditions: [], confidence: 0.98,
      rawEmailId: "basket-1", rawBody: "100 units", language: "en",
    });
    await owner.mutation(api.allocations.computeAllocation, { needId });
    const summary: any[] = await owner.query(api.allocations.listPlansByIncident, { incidentId });
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({ qty: 100, totalQty: 100, status: "proposed" });
    await expect(stranger.query(api.allocations.listPlansByIncident, { incidentId })).rejects.toThrow(/not found/i);
  });

  test("a drift-minted plan on offers with field evidence stays approvable", async () => {
    const t = asUser(makeT());
    const { needId } = await seedNeed(t, { certRequired: "NSF/ANSI 53", evidenceKey: "NF-53" });
    const suppliers: any[] = await seedSuppliers(t);
    const span = (quote: string) => ({ confidence: 0.98, start: 0, end: quote.length, quote });
    const fieldEvidence = {
      qty: span("100 units"), price: span("$10 each"), arrival: span("by Friday"), cert: span("NSF/ANSI 53"),
    };
    const ids = [];
    for (const [index, supplier] of suppliers.slice(0, 2).entries()) {
      ids.push(await t.mutation(internal.offers.upsertOfferVersion, {
        needId, supplierId: supplier._id, qty: 100, unitPriceCents: 1000 + index * 100,
        arrivalAt: Date.now() + 60 * 60 * 1000, certStatus: "verified", conditions: [], confidence: 0.98,
        fieldEvidence, rawEmailId: `evidence-${index}`, rawBody: "100 certified units", language: "en",
      }));
    }
    await t.mutation(internal.evidenceDrift.applyPublicRecall, {
      needId,
      offerIds: [ids[0]],
      sourceUrl: "https://www.cpsc.gov/Recalls/test-recall",
      quote: "RECALL ACTIVE: model NF-53 stop distribution",
      contentHash: "test-hash",
    });
    const plans: any[] = await t.query(api.allocations.listAllocationPlans, { needId });
    expect(plans[0].totalQty).toBe(100);
    await t.mutation(api.allocations.approvePlan, { planId: plans[0]._id });
    const approved: any[] = await t.query(api.allocations.listAllocationPlans, { needId });
    expect(approved[0].status).toBe("approved");
  });

  test("drift snapshots keep a stable envelope", () => {
    expect(buildDriftSnapshot({
      incident: { id: "i", title: "T" },
      need: { id: "n", item: "X", qty: 1 },
      plan: { id: "p", coverage: 1, costCents: 2, suppliers: ["S"] },
    })).toBe('{"incident":{"id":"i","title":"T"},"need":{"id":"n","item":"X","qty":1},"plan":{"id":"p","coverage":1,"costCents":2,"suppliers":["S"]}}');
  });

  test("award notices move sending → sent and failed → sending", async () => {
    const t = asUser(makeT(), "award-owner", "Award Owner");
    const { needId } = await seedNeed(t);
    const suppliers: any[] = await seedSuppliers(t);
    await t.mutation(api.rfq.createRfqThreadsForNeed, { needId, supplierIds: [suppliers[0]._id, suppliers[1]._id] });
    const threads: any[] = await t.query(api.rfq.listThreadsByNeed, { needId });
    await t.mutation(internal.offers.upsertOfferVersion, {
      needId, supplierId: suppliers[0]._id, qty: 100, unitPriceCents: 1000, arrivalAt: Date.now() + 60 * 60 * 1000,
      certStatus: "verified", conditions: [], confidence: 0.98,
      rawEmailId: "award-1", rawBody: "100 units", language: "en",
    });
    const computed: any = await t.mutation(api.allocations.computeAllocation, { needId });

    const first: any = await t.mutation(internal.awardNotices.claimNotice, {
      planId: computed.planId, threadId: threads[0]._id, kind: "award",
    });
    expect(first.shouldSend).toBe(true);
    expect(first.shouldReconcile).toBe(false);
    const retry: any = await t.mutation(internal.awardNotices.claimNotice, {
      planId: computed.planId, threadId: threads[0]._id, kind: "award",
    });
    expect(retry.shouldSend).toBe(false);
    expect(retry.shouldReconcile).toBe(true);
    await t.mutation(internal.awardNotices.finishNotice, { noticeId: first.noticeId, status: "sent", messageId: "m-1" });
    const done: any = await t.mutation(internal.awardNotices.claimNotice, {
      planId: computed.planId, threadId: threads[0]._id, kind: "award",
    });
    expect(done.shouldSend).toBe(false);
    expect(done.shouldReconcile).toBe(false);

    const decline: any = await t.mutation(internal.awardNotices.claimNotice, {
      planId: computed.planId, threadId: threads[1]._id, kind: "decline",
    });
    expect(decline.shouldSend).toBe(true);
    await t.mutation(internal.awardNotices.finishNotice, { noticeId: decline.noticeId, status: "failed", error: "provider 429" });
    const retried: any = await t.mutation(internal.awardNotices.claimNotice, {
      planId: computed.planId, threadId: threads[1]._id, kind: "decline",
    });
    expect(retried.shouldSend).toBe(true);
    expect(retried.shouldReconcile).toBe(false);

    await t.mutation(api.allocations.approvePlan, { planId: computed.planId });
    const dispatch: any = await t.query(internal.awardNotices.getDispatch, { planId: computed.planId });
    expect(dispatch.ownerId).toContain("award-owner");
    expect(dispatch.threads).toHaveLength(2);
  });

  test("need workspace joins offers, threads, plan, and coverage in canonical order", async () => {
    const raw = makeT();
    const owner = asUser(raw, "workspace-owner", "Workspace Owner");
    const stranger = asUser(raw, "workspace-stranger", "Workspace Stranger");
    const { needId } = await seedNeed(owner, { qty: 100 });
    const suppliers: any[] = await seedSuppliers(owner);
    await owner.mutation(api.rfq.createRfqThreadsForNeed, { needId, supplierIds: [suppliers[0]._id, suppliers[1]._id] });
    const offerA: string = await owner.mutation(internal.offers.upsertOfferVersion, {
      needId, supplierId: suppliers[0]._id, qty: 100, unitPriceCents: 1100, arrivalAt: Date.now() + 60 * 60 * 1000,
      certStatus: "verified", conditions: [], confidence: 0.97,
      rawEmailId: "ws-a", rawBody: "100 units at eleven", language: "en",
    });
    await owner.mutation(internal.offers.upsertOfferVersion, {
      needId, supplierId: suppliers[1]._id, qty: 100, unitPriceCents: 900, arrivalAt: Date.now() + 60 * 60 * 1000,
      certStatus: "needs_review", conditions: [], confidence: 0.5,
      rawEmailId: "ws-b", rawBody: "100 units at nine", language: "en",
    });
    await owner.mutation(internal.sourceChecks.addSourceCheck, {
      offerId: offerA,
      url: "https://www.nsf.org/cert",
      quote: "NSF/ANSI 53",
      status: "verified",
      reason: "authoritative exact match",
      type: "cert",
      claim: "NSF/ANSI 53",
      sourceAuthority: "authoritative",
      contentHash: "h",
      matched: true,
    });
    const workspace: any = await owner.query(api.workspace.getNeedWorkspace, { needId });
    expect(workspace.need._id).toBe(needId);
    expect(workspace.offers.map((o: any) => o.unitPriceCents)).toEqual([1100, 900]);
    expect(workspace.offers[0].isVerified).toBe(true);
    expect(workspace.offers[0].ambiguous).toBe(false);
    expect(workspace.offers[0].verified).toBe(true);
    expect(workspace.offers[0].rawBody).toBe("100 units at eleven");
    expect(workspace.offers[0].supplier.name).toBe(suppliers[0].name);
    expect(workspace.offers[1].ambiguous).toBe(true);
    expect(workspace.threads).toHaveLength(2);
    expect(workspace.threads[0].supplier).toBeDefined();
    expect(workspace.latestPlan).toBeNull();
    expect(workspace.coverage).toMatchObject({ offerCount: 2, totalQty: 200 });
    expect(workspace.verifiedOfferCount).toBe(1);
    await expect(stranger.query(api.workspace.getNeedWorkspace, { needId })).rejects.toThrow(/not found/i);
  });

  test("deadline watchdog escalates once per half-day per need", async () => {
    const t = asUser(makeT());
    const incidentId = await t.mutation(api.incidents.createIncident, {
      title: "Watch",
      deadlineAt: Date.now() + 60 * 60 * 1000,
    });
    const needId = await t.mutation(api.needs.createNeed, {
      incidentId,
      item: "Filters",
      qty: 100,
      deadlineAt: Date.now() + 60 * 60 * 1000,
      budgetCents: 120000,
      partialAllowed: true,
    });
    const suppliers: any[] = await seedSuppliers(t);
    await t.mutation(internal.offers.upsertOfferVersion, {
      needId, supplierId: suppliers[0]._id, qty: 100, unitPriceCents: 1000, arrivalAt: Date.now() + 30 * 60 * 1000,
      certStatus: "needs_review", conditions: [], confidence: 0.5,
      rawEmailId: "watch-1", rawBody: "vague quote", language: "en",
    });
    await t.mutation(api.allocations.computeAllocation, { needId });
    const first: any = await t.mutation(internal.watchdog.checkDeadlines, {});
    expect(first.atRisk).toBe(1);
    const second: any = await t.mutation(internal.watchdog.checkDeadlines, {});
    expect(second.atRisk).toBe(0);
    const needs: any[] = await t.query(api.needs.listNeedsByIncident, { incidentId });
    expect(typeof needs[0].lastEscalatedAt).toBe("number");
  });

  test("new terms supersede the live plan through the public seam", async () => {
    const t = asUser(makeT());
    const { needId } = await seedNeed(t, { qty: 100, budgetCents: 100000 });
    const suppliers: any[] = await seedSuppliers(t);
    const arrival = Date.now() + 60 * 60 * 1000;
    await t.mutation(internal.offers.upsertOfferVersion, {
      needId, supplierId: suppliers[0]._id, qty: 100, unitPriceCents: 1000, arrivalAt: arrival,
      certStatus: "verified", conditions: [], confidence: 0.98,
      rawEmailId: "terms-1", rawBody: "100 units", language: "en",
    });
    const first: any = await t.mutation(api.allocations.computeAllocation, { needId });
    expect(first.planId).not.toBeNull();
    await t.mutation(internal.offers.upsertOfferVersion, {
      needId, supplierId: suppliers[1]._id, qty: 100, unitPriceCents: 800, arrivalAt: arrival,
      certStatus: "verified", conditions: [], confidence: 0.98,
      rawEmailId: "terms-2", rawBody: "100 cheaper units", language: "en",
    });
    const second: any = await t.mutation(api.allocations.computeAllocation, { needId });
    expect(second.planId).not.toBe(first.planId);
    expect(second.totalCostCents).toBe(80000);
    const plans: any[] = await t.query(api.allocations.listAllocationPlans, { needId });
    const byId = Object.fromEntries(plans.map((p) => [String(p._id), p.status]));
    expect(byId[String(first.planId)]).toBe("superseded");
    expect(byId[String(second.planId)]).toBe("proposed");
  });

});
