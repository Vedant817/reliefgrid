import { v } from "convex/values";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { allocateOffers } from "./lib/allocate";
import { writeAudit } from "./lib/audit";
import { offersByNeed } from "./offerTotals";
import { requireOwnerId } from "./model/auth";
import { allocationInputHash } from "./lib/allocationHash";
import { cancel, getStatus } from "@convex-dev/workflow";
import { components } from "./_generated/api";

const DEMO_TITLE = "Flood Shelter - North District";
const LEGACY_DEMO_TITLE = "Flood Shelter — North District";

const supplierFixtures = [
  { name: "Apex Medical Supply", contactEmail: "rfq+apex@synthetic.reliefgrid.test", region: "North", verified: true },
  { name: "BlueRiver Logistics", contactEmail: "rfq+blueriver@synthetic.reliefgrid.test", region: "Central", verified: true },
  { name: "Casa Suministros", contactEmail: "rfq+casa@synthetic.reliefgrid.test", region: "South", verified: true },
] as const;

async function deleteAudit(ctx: MutationCtx, entity: string, entityId: string) {
  const events = await ctx.db
    .query("auditEvents")
    .withIndex("by_entity", (q) => q.eq("entity", entity).eq("entityId", entityId))
    .take(500);
  for (const event of events) await ctx.db.delete(event._id);
}

async function deleteDemoIncident(ctx: MutationCtx, incidentId: any) {
  const needs = await ctx.db
    .query("needs")
    .withIndex("by_incident", (q) => q.eq("incidentId", incidentId))
    .take(10);

  for (const need of needs) {
    const plans = await ctx.db.query("allocationPlans").withIndex("by_need", (q) => q.eq("needId", need._id)).take(100);
    for (const plan of plans) {
      const notices = await ctx.db.query("awardNotices").withIndex("by_plan", (q) => q.eq("planId", plan._id)).take(100);
      for (const notice of notices) await ctx.db.delete(notice._id);
      const lines = await ctx.db.query("allocationLines").withIndex("by_plan", (q) => q.eq("planId", plan._id)).take(200);
      for (const line of lines) await ctx.db.delete(line._id);
      const approvals = await ctx.db.query("approvals").withIndex("by_plan", (q) => q.eq("planId", plan._id)).take(10);
      for (const approval of approvals) await ctx.db.delete(approval._id);
      await deleteAudit(ctx, "allocationPlans", String(plan._id));
      await ctx.db.delete(plan._id);
    }

    const offers = await ctx.db.query("offers").withIndex("by_need", (q) => q.eq("needId", need._id)).take(200);
    for (const offer of offers) {
      const checks = await ctx.db.query("sourceChecks").withIndex("by_offer", (q) => q.eq("offerId", offer._id)).take(100);
      for (const check of checks) await ctx.db.delete(check._id);
      const attachments = await ctx.db.query("evidenceAttachments").withIndex("by_offer", (q) => q.eq("offerId", offer._id)).take(20);
      for (const attachment of attachments) {
        await ctx.storage.delete(attachment.storageId);
        await ctx.db.delete(attachment._id);
      }
      const versions = await ctx.db.query("offerVersions").withIndex("by_offer", (q) => q.eq("offerId", offer._id)).take(500);
      for (const version of versions) await ctx.db.delete(version._id);
      await deleteAudit(ctx, "offers", String(offer._id));
      await offersByNeed.deleteIfExists(ctx, offer);
      await ctx.db.delete(offer._id);
    }

    const threads = await ctx.db.query("rfqThreads").withIndex("by_need", (q) => q.eq("needId", need._id)).take(100);
    for (const thread of threads) {
      await deleteAudit(ctx, "rfqThreads", String(thread._id));
      await ctx.db.delete(thread._id);
    }
    const inboxes = await ctx.db.query("inboxes").withIndex("by_need", (q) => q.eq("needId", need._id)).take(5);
    for (const inbox of inboxes) await ctx.db.delete(inbox._id);
    const inboxClaims = await ctx.db.query("inboxClaims").withIndex("by_need", (q) => q.eq("needId", need._id)).take(2);
    for (const claim of inboxClaims) await ctx.db.delete(claim._id);
    const deliveries = await ctx.db.query("deliveries").withIndex("by_need", (q) => q.eq("needId", need._id)).take(100);
    for (const delivery of deliveries) await ctx.db.delete(delivery._id);
    const holdNotices = await ctx.db.query("holdNotices").withIndex("by_need", (q) => q.eq("needId", need._id)).take(100);
    for (const notice of holdNotices) await ctx.db.delete(notice._id);
    const recoveryRuns = await ctx.db.query("recoveryRuns").withIndex("by_need", (q) => q.eq("needId", need._id)).take(20);
    for (const run of recoveryRuns) {
      const status = await getStatus(ctx, components.workflow, run.workflowId as any);
      if (status.type === "inProgress") await cancel(ctx, components.workflow, run.workflowId as any);
      await ctx.db.delete(run._id);
    }
    const orphanVersions = await ctx.db.query("offerVersions").withIndex("by_need", (q) => q.eq("needId", need._id)).take(500);
    for (const version of orphanVersions) await ctx.db.delete(version._id);
    await deleteAudit(ctx, "needs", String(need._id));
    await ctx.db.delete(need._id);
  }
  await deleteAudit(ctx, "incidents", String(incidentId));
  await ctx.db.delete(incidentId);
}

export async function resetDemoData(ctx: MutationCtx) {
  const ownerId = await requireOwnerId(ctx);
  const demoIncidents = [
    ...(await ctx.db.query("incidents").withIndex("by_owner_and_title", (q) => q.eq("ownerId", ownerId).eq("title", DEMO_TITLE)).take(10)),
    ...(await ctx.db.query("incidents").withIndex("by_owner_and_title", (q) => q.eq("ownerId", ownerId).eq("title", LEGACY_DEMO_TITLE)).take(10)),
  ];
  for (const incident of demoIncidents) {
    if (incident.isDemo) await deleteDemoIncident(ctx, incident._id);
  }

  const now = Date.now();
  const supplierIds = [];
  for (const fixture of supplierFixtures) {
    const existing = await ctx.db
      .query("suppliers")
      .withIndex("by_owner_and_email", (q) => q.eq("ownerId", ownerId).eq("contactEmail", fixture.contactEmail))
      .unique();
    supplierIds.push(existing?._id ?? await ctx.db.insert("suppliers", { ...fixture, ownerId, createdAt: now }));
  }

  const incidentId = await ctx.db.insert("incidents", {
    title: DEMO_TITLE,
    orgId: "demo:reliefgrid",
    status: "awaiting_approval",
    deadlineAt: now + 6 * 60 * 60 * 1000,
    createdAt: now,
    updatedAt: now,
    description: "Synthetic flood response scenario for 200 residents.",
    ownerId,
    isDemo: true,
  });
  const needId = await ctx.db.insert("needs", {
    incidentId,
    item: "Portable water filters (NSF/ANSI 53)",
    qty: 100,
    deadlineAt: now + 4 * 60 * 60 * 1000,
    budgetCents: 120000,
    certRequired: "NSF/ANSI 53",
    evidenceKey: "NF-53",
    partialAllowed: true,
    status: "planning",
    createdAt: now,
  });

  const offerFixtures = [
    { qty: 70, unitPriceCents: 1100, arrivalAt: now + 2 * 3600000, language: "en", confidence: 0.97, body: "We can deliver 70 filters at $11 each by 4 PM. Certified NSF/ANSI 53." },
    { qty: 100, unitPriceCents: 900, arrivalAt: now + 20 * 3600000, language: "en", confidence: 0.95, body: "We have 100 filters at $9 each, delivery tomorrow morning." },
    { qty: 30, unitPriceCents: 1000, arrivalAt: now + 3 * 3600000, language: "es", confidence: 0.96, body: "Podemos entregar 30 unidades certificadas a $10 cada una antes de las 5 PM." },
  ] as const;

  const offers = [];
  for (let index = 0; index < supplierIds.length; index++) {
    const supplierId = supplierIds[index];
    const fixture = offerFixtures[index];
    await ctx.db.insert("rfqThreads", {
      needId, supplierId, inboxId: `demo-inbox-${index}`, threadId: `demo-thread-${index}`,
      status: "replied", sentAt: now, lastReplyAt: now,
    });
    const offerId = await ctx.db.insert("offers", {
      needId, supplierId, qty: fixture.qty, unitPriceCents: fixture.unitPriceCents,
      arrivalAt: fixture.arrivalAt, certStatus: "verified", conditions: [],
      confidence: fixture.confidence, rawEmailId: `demo-email-${index}`,
      language: fixture.language, status: "active", updatedAt: now,
    });
    const versionId = await ctx.db.insert("offerVersions", {
      offerId, needId, supplierId, qty: fixture.qty, unitPriceCents: fixture.unitPriceCents,
      arrivalAt: fixture.arrivalAt, certStatus: "verified", conditions: [],
      confidence: fixture.confidence, rawEmailId: `demo-email-${index}`,
      rawBody: fixture.body, language: fixture.language, createdAt: now,
    });
    await ctx.db.patch(offerId, { currentVersionId: versionId });
    const insertedOffer = await ctx.db.get(offerId);
    await offersByNeed.insert(ctx, insertedOffer!);
    await ctx.db.insert("sourceChecks", {
      offerId, url: "https://example.com/demo/filter-nsf53", quote: "NSF/ANSI 53 certification confirmed",
      retrievedAt: now, status: "verified", reason: "Labeled synthetic verification fixture", type: "cert",
    });
    offers.push({ offerId, supplierId, supplierName: supplierFixtures[index].name, ...fixture, certStatus: "verified" });
  }

  const result = allocateOffers(offers, {
    qty: 100, budgetCents: 120000, deadlineAt: now + 4 * 3600000,
    certRequired: "NSF/ANSI 53", partialAllowed: true,
  });
  const planId = await ctx.db.insert("allocationPlans", {
    needId, status: "proposed", totalCostCents: result.totalCostCents,
    totalQty: result.totalQty, createdAt: now, decisionTrace: result.trace,
    inputHash: allocationInputHash({ qty: 100, budgetCents: 120000, deadlineAt: now + 4 * 3600000, certRequired: "NSF/ANSI 53", partialAllowed: true }, offers),
  });
  for (const selected of result.selected) {
    await ctx.db.insert("allocationLines", {
      planId, supplierId: selected.supplierId as any, offerId: selected.offerId as any,
      qty: selected.qty, costCents: selected.qty * selected.unitPriceCents,
      reason: "selected: cheapest feasible covering",
    });
  }

  const bulletin = await ctx.db.query("demoBulletins").withIndex("by_owner_and_key", (q) => q.eq("ownerId", ownerId).eq("key", "filter-nsf53")).unique();
  const bulletinValue = { title: "Northstar Filter Model NF-53 Safety Bulletin", state: "CLEAR" as const, body: "No active safety notices for model NF-53.", updatedAt: now };
  if (bulletin) await ctx.db.patch(bulletin._id, bulletinValue);
  else await ctx.db.insert("demoBulletins", { key: "filter-nsf53", ownerId, ...bulletinValue });

  const snapshotBase = { incident: { id: String(incidentId), title: DEMO_TITLE }, need: { id: String(needId), item: "Portable water filters (NSF/ANSI 53)", qty: 100 } };
  await writeAudit(ctx, {
    entity: "incidents", entityId: incidentId, action: "demo_need_created", actor: "judge-mode", incidentId,
    snapshot: JSON.stringify({ ...snapshotBase, offers: [], plan: null }),
  });
  await writeAudit(ctx, {
    entity: "incidents", entityId: incidentId, action: "demo_replies_received", actor: "judge-mode", incidentId,
    snapshot: JSON.stringify({ ...snapshotBase, offers: offers.map((offer) => ({ supplier: offer.supplierName, qty: offer.qty, certStatus: "needs_review" })), plan: null }),
  });
  await writeAudit(ctx, {
    entity: "incidents", entityId: incidentId, action: "demo_sources_verified", actor: "judge-mode", incidentId,
    snapshot: JSON.stringify({ ...snapshotBase, offers: offers.map((offer) => ({ supplier: offer.supplierName, qty: offer.qty, certStatus: "verified" })), plan: null }),
  });
  await writeAudit(ctx, {
    entity: "incidents", entityId: incidentId, action: "demo_plan_proposed", actor: "allocator", incidentId,
    snapshot: JSON.stringify({ ...snapshotBase, offers: offers.map((offer) => ({ supplier: offer.supplierName, qty: offer.qty, certStatus: "verified" })), plan: { id: String(planId), coverage: result.totalQty, costCents: result.totalCostCents, suppliers: result.selected.map((offer) => offer.supplierName) } }),
  });

  return { incidentId, needId, planId };
}

// Removes one incident and its entire graph (needs, offers, plans, threads,
// audits, attachments). Used to purge scratch/test incidents; the canonical
// demo is rebuilt with resetDemo afterwards.
export const purgeIncident = internalMutation({
  args: { incidentId: v.id("incidents") },
  returns: v.object({ purged: v.boolean() }),
  handler: async (ctx, args) => {
    await deleteDemoIncident(ctx, args.incidentId);
    return { purged: true };
  },
});

export const resetDemo = mutation({
  args: {},
  returns: v.object({
    incidentId: v.id("incidents"),
    needId: v.id("needs"),
    planId: v.id("allocationPlans"),
  }),
  handler: resetDemoData,
});
