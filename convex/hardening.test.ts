import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
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
  return await t.mutation(api.suppliers.seedSuppliers, {});
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

  test("normal incidents cannot inject synthetic replacement stock", async () => {
    const t = asUser(makeT());
    const { needId } = await seedNeed(t);
    await expect(t.mutation(api.evidenceDrift.addReplacementOffer, { needId })).rejects.toThrow(/controlled demo/i);
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

  test("provider history is isolated by owner", async () => {
    const raw = makeT();
    const ownerA = asUser(raw, "provider-a", "Provider A");
    const ownerB = asUser(raw, "provider-b", "Provider B");
    await raw.mutation(internal.health.recordProviderRun, { provider: "firecrawl", operation: "a", status: "live", ownerId: "https://tests.reliefgrid.test|provider-a" });
    await raw.mutation(internal.health.recordProviderRun, { provider: "agentmail", operation: "b", status: "live", ownerId: "https://tests.reliefgrid.test|provider-b" });
    const runsA: any[] = await ownerA.query(api.health.listProviderRuns, {});
    const runsB: any[] = await ownerB.query(api.health.listProviderRuns, {});
    expect(runsA.map((run) => run.operation)).toEqual(["a"]);
    expect(runsB.map((run) => run.operation)).toEqual(["b"]);
  });

  test("public demo bulletin exposes only display fields and recall setup can roll back", async () => {
    const t = asUser(makeT());
    const reset: any = await t.mutation(api.demo.resetDemo, {});
    const state: any = await t.query(api.evidenceDrift.getEvidenceDriftState, { needId: reset.needId });
    const bulletinId = state.bulletin._id;

    await t.mutation(internal.evidenceDrift.setBulletinRecall, { needId: reset.needId });
    expect((await t.query(api.evidenceDrift.getPublicBulletin, { bulletinId }))?.state).toBe("RECALL_ACTIVE");
    await t.mutation(internal.evidenceDrift.restoreBulletinClear, { bulletinId });
    const publicBulletin: any = await t.query(api.evidenceDrift.getPublicBulletin, { bulletinId });
    expect(publicBulletin).toEqual({
      title: "Northstar Filter Model NF-53 Safety Bulletin",
      state: "CLEAR",
      body: "No active safety notices for model NF-53.",
      updatedAt: expect.any(Number),
    });
    expect(publicBulletin.ownerId).toBeUndefined();
  });
});
