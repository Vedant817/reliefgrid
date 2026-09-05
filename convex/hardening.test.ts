import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import aggregate from "@convex-dev/aggregate/test";

const modules = import.meta.glob("./**/*.*s");
const future = () => Date.now() + 6 * 3600 * 1000;

function makeT() {
  const t = convexTest(schema, modules);
  aggregate.register(t);
  return t;
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
    const t = makeT();
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
    const t = makeT();
    const { needId } = await seedNeed(t);
    const suppliers: any[] = await seedSuppliers(t);
    const supplierId = suppliers[0]._id;
    const base = {
      needId, supplierId, qty: 60, unitPriceCents: 1100, arrivalAt: future(),
      certStatus: "verified", conditions: [], confidence: 0.97,
      rawEmailId: "t-1", rawBody: "60 filters", language: "en",
    };
    await expect(t.mutation(api.offers.upsertOfferVersion, { ...base, unitPriceCents: -5 })).rejects.toThrow();
    const id1: string = await t.mutation(api.offers.upsertOfferVersion, base);
    await expect(
      t.mutation(api.offers.upsertOfferVersion, { ...base, qty: 70 }),
    ).rejects.toThrow(/divergent/);
    const id2: string = await t.mutation(api.offers.upsertOfferVersion, base);
    expect(id2).toBe(id1);
  });
});

describe("approval state machine", () => {
  test("guards approver, double-approve, retired plans, and enforces single award", async () => {
    const t = makeT();
    const { needId } = await seedNeed(t);
    const suppliers: any[] = await seedSuppliers(t);
    await t.mutation(api.offers.upsertOfferVersion, {
      needId, supplierId: suppliers[0]._id, qty: 100, unitPriceCents: 1000, arrivalAt: Date.now() + 3600000,
      certStatus: "verified", conditions: [], confidence: 0.97,
      rawEmailId: "t-a", rawBody: "100 units", language: "en",
    });
    const first: any = await t.mutation(api.allocations.computeAllocation, { needId });
    expect(first.planId).not.toBeNull();
    await expect(t.mutation(api.allocations.approvePlan, { planId: first.planId, approvedBy: "  " })).rejects.toThrow();
    await t.mutation(api.allocations.approvePlan, { planId: first.planId, approvedBy: "Tester" });
    await expect(
      t.mutation(api.allocations.approvePlan, { planId: first.planId, approvedBy: "Tester" }),
    ).rejects.toThrow(/proposed/);
    // Identical recompute dedups instead of minting a duplicate.
    const again: any = await t.mutation(api.allocations.computeAllocation, { needId });
    expect(again.planId).toBe(first.planId);
    // New terms supersede; approving the new plan retires the old award.
    await t.mutation(api.offers.upsertOfferVersion, {
      needId, supplierId: suppliers[1]._id, qty: 100, unitPriceCents: 900, arrivalAt: Date.now() + 3600000,
      certStatus: "verified", conditions: [], confidence: 0.95,
      rawEmailId: "t-b", rawBody: "100 units cheap", language: "en",
    });
    const second: any = await t.mutation(api.allocations.computeAllocation, { needId });
    expect(second.planId).not.toBe(first.planId);
    await t.mutation(api.allocations.approvePlan, { planId: second.planId, approvedBy: "Tester" });
    const plans: any[] = await t.query(api.allocations.listAllocationPlans, { needId });
    const statuses = Object.fromEntries(plans.map((p) => [p._id, p.status]));
    expect(statuses[first.planId]).toBe("superseded");
    expect(statuses[second.planId]).toBe("approved");
    await expect(
      t.mutation(api.allocations.approvePlan, { planId: first.planId, approvedBy: "Tester" }),
    ).rejects.toThrow(/proposed/);
  });

  test("server identity wins over the client-supplied approver name", async () => {
    const t = makeT();
    const { needId } = await seedNeed(t);
    const suppliers: any[] = await seedSuppliers(t);
    await t.mutation(api.offers.upsertOfferVersion, {
      needId, supplierId: suppliers[0]._id, qty: 100, unitPriceCents: 1000, arrivalAt: Date.now() + 3600000,
      certStatus: "verified", conditions: [], confidence: 0.97,
      rawEmailId: "t-c", rawBody: "100 units", language: "en",
    });
    const plan: any = await t.mutation(api.allocations.computeAllocation, { needId });
    const authed = t.withIdentity({ subject: "user_server_1" });
    await authed.mutation(api.allocations.approvePlan, { planId: plan.planId, approvedBy: "forged@evil.test" });
    const plans: any[] = await t.query(api.allocations.listAllocationPlans, { needId });
    expect(plans[0].approval.approvedBy).toBe("user_server_1");
  });

  test("empty need mints no plan", async () => {
    const t = makeT();
    const { needId } = await seedNeed(t);
    const result: any = await t.mutation(api.allocations.computeAllocation, { needId });
    expect(result.planId).toBeNull();
    expect(result.feasible).toBe(false);
  });
});

describe("thread status enum", () => {
  test("rejects unknown statuses", async () => {
    const t = makeT();
    const { needId } = await seedNeed(t);
    const suppliers: any[] = await seedSuppliers(t);
    await t.mutation(api.rfq.createRfqThreadsForNeed, { needId, supplierIds: [suppliers[0]._id] });
    const threads: any[] = await t.query(api.rfq.listThreadsByNeed, { needId });
    await expect(
      t.mutation(api.rfq.updateThreadStatus, { threadId: threads[0]._id, status: "hacked" as any }),
    ).rejects.toThrow();
  });
});
