/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import aggregate from "@convex-dev/aggregate/test";
import { matchNeedsByKeywords } from "./lib/matchNeeds";

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

describe("basket coverage rollup", () => {
  test("computes per-need coverage and totals server-side", async () => {
    const t = asUser(makeT(), "basket-rollup-owner", "Basket Rollup Owner");
    const incidentId = await t.mutation(api.incidents.createIncident, {
      title: "Basket incident",
      deadlineAt: future(),
    });
    const needA = await t.mutation(api.needs.createNeed, {
      incidentId,
      item: "Portable Water Filters",
      qty: 100,
      deadlineAt: future(),
      budgetCents: 120000,
      partialAllowed: true,
    });
    const needB = await t.mutation(api.needs.createNeed, {
      incidentId,
      item: "Solar Blankets",
      qty: 50,
      deadlineAt: future(),
      budgetCents: 50000,
      partialAllowed: true,
    });
    const suppliers: any[] = await seedSuppliers(t);
    await t.mutation(internal.offers.upsertOfferVersion, {
      needId: needA,
      supplierId: suppliers[0]._id,
      qty: 100,
      unitPriceCents: 1000,
      arrivalAt: Date.now() + 3600000,
      certStatus: "verified",
      conditions: [],
      confidence: 0.98,
      rawEmailId: "basket-rollup-1",
      rawBody: "100 filters",
      language: "en",
    });
    await t.mutation(api.allocations.computeAllocation, { needId: needA });

    const coverage: any = await t.query(api.allocations.getBasketCoverage, { incidentId });
    expect(coverage.needs).toHaveLength(2);
    const byId = Object.fromEntries(coverage.needs.map((n: any) => [String(n.needId), n]));
    expect(byId[String(needA)]).toMatchObject({
      qty: 100,
      coveredQty: 100,
      plannedCostCents: 100000,
      status: "proposed",
    });
    // A need with no plan contributes zeros.
    expect(byId[String(needB)]).toMatchObject({
      qty: 50,
      coveredQty: 0,
      plannedCostCents: 0,
      status: "none",
    });
    expect(coverage.totals).toMatchObject({
      needs: 2,
      fullyCovered: 1,
      totalQty: 100,
      totalNeedQty: 150,
      totalCostCents: 100000,
    });
  });

  test("stranger cannot read another owner's basket", async () => {
    const raw = makeT();
    const owner = asUser(raw, "basket-iso-owner", "Basket Iso Owner");
    const stranger = asUser(raw, "basket-iso-stranger", "Basket Iso Stranger");
    const incidentId = await owner.mutation(api.incidents.createIncident, {
      title: "Iso incident",
      deadlineAt: future(),
    });
    await owner.mutation(api.needs.createNeed, {
      incidentId,
      item: "Portable Water Filters",
      qty: 10,
      deadlineAt: future(),
      budgetCents: 10000,
      partialAllowed: true,
    });
    await expect(stranger.query(api.allocations.getBasketCoverage, { incidentId })).rejects.toThrow(
      /not found/i,
    );
  });
});

describe("multi-need email ingest", () => {
  test("one reply naming both items flows through the email entry without breaking the primary path", async () => {
    const t = asUser(makeT(), "basket-email-owner", "Basket Email Owner");
    const incidentId = await t.mutation(api.incidents.createIncident, {
      title: "Multi-need incident",
      deadlineAt: future(),
    });
    const needA = await t.mutation(api.needs.createNeed, {
      incidentId,
      item: "Portable Water Filters",
      qty: 100,
      deadlineAt: future(),
      budgetCents: 120000,
      partialAllowed: true,
    });
    const needB = await t.mutation(api.needs.createNeed, {
      incidentId,
      item: "Solar Blankets",
      qty: 50,
      deadlineAt: future(),
      budgetCents: 50000,
      partialAllowed: true,
    });
    const supplierId: string = await t.mutation(api.suppliers.upsertSupplier, {
      name: "Multi Supplier",
      contactEmail: "multi-quotes@example.org",
      region: "Test region",
    });
    await t.mutation(internal.inboxes.ensureInbox, {
      needId: needA,
      inboxId: "inbox-multi",
      email: "multi@example.test",
    });
    await t.mutation(api.rfq.createRfqThreadsForNeed, { needId: needA, supplierIds: [supplierId] });
    const threads: any[] = await t.query(api.rfq.listThreadsByNeed, { needId: needA });
    const threadId = threads[0]._id;
    await t.mutation(internal.rfq.claimRfqSend, { threadId });
    await t.mutation(internal.rfq.recordAgentMailSend, {
      threadId,
      agentmailThreadId: "thread-multi-1",
      agentmailMessageId: "message-multi-1",
    });

    const body =
      "Hello, we can supply 100 portable water filters at $10 each and 50 solar blankets ready tomorrow.";
    // The matcher the fan-out uses sees both sibling items in one body.
    expect(
      matchNeedsByKeywords(body, [
        { _id: String(needA), item: "Portable Water Filters" },
        { _id: String(needB), item: "Solar Blankets" },
      ]).sort(),
    ).toEqual([String(needA), String(needB)].sort());

    // Drive the webhook's internal mutation path with no network: scheduling
    // the Groq extraction is deferred, so this asserts the primary reply still
    // lands even with the fan-out block active.
    await t.mutation(internal.email.onInboundReply, {
      message: {
        message_id: "msg-multi-1",
        thread_id: "thread-multi-1",
        text: body,
        from: "multi-quotes@example.org",
        timestamp: new Date().toISOString(),
      },
      thread: { thread_id: "thread-multi-1", references: [] },
      eventId: "evt-multi-1",
    });
    const after: any[] = await t.query(api.rfq.listThreadsByNeed, { needId: needA });
    expect(after[0].status).toBe("replied");

    // NOTE (provider requirement): the scheduled extractOfferFromEmail action
    // needs a live Groq/OpenAI key and throws "no LLM key configured" without
    // one, so unit tests do not execute it. Instead we drive the exact
    // internal mutation the action calls after LLM success (upsertOfferVersion)
    // for both needs sharing one rawEmailId, then verify the rollup reflects
    // multi-need ingest.
    const rawEmailId = "agentmail-msg-multi-1";
    await t.mutation(internal.offers.upsertOfferVersion, {
      needId: needA,
      supplierId,
      qty: 100,
      unitPriceCents: 1000,
      arrivalAt: Date.now() + 3600000,
      certStatus: "verified",
      conditions: [],
      confidence: 0.97,
      rawEmailId,
      rawBody: body,
      language: "en",
    });
    await t.mutation(internal.offers.upsertOfferVersion, {
      needId: needB,
      supplierId,
      qty: 50,
      unitPriceCents: 800,
      arrivalAt: Date.now() + 3600000,
      certStatus: "verified",
      conditions: [],
      confidence: 0.97,
      rawEmailId,
      rawBody: body,
      language: "en",
    });
    await t.mutation(api.allocations.computeAllocation, { needId: needA });
    await t.mutation(api.allocations.computeAllocation, { needId: needB });
    const coverage: any = await t.query(api.allocations.getBasketCoverage, { incidentId });
    expect(coverage.totals).toMatchObject({ needs: 2, fullyCovered: 2 });
    expect(coverage.needs).toHaveLength(2);
  });
});
