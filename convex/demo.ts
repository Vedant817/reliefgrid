import { v } from "convex/values";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { buildDriftSnapshot } from "./lib/drift";
import { offersByNeed } from "./offerTotals";
import { requireOwnerId } from "./model/auth";
import { recomputeAllocation } from "./allocations";
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

// Every need-scoped table the purge must empty, next to the deleter it
// drives — not scattered across hand-written loops. A schema addition that
// introduces a need/plan/offer-scoped table is one row here, or reset
// orphans the new table's rows. Keep beside convex/schema.ts.
type CascadeChild = {
  table:
    | "allocationPlans"
    | "allocationLines"
    | "approvals"
    | "awardNotices"
    | "offers"
    | "sourceChecks"
    | "evidenceAttachments"
    | "offerVersions"
    | "rfqThreads"
    | "inboxes"
    | "inboxClaims"
    | "deliveries"
    | "holdNotices"
    | "recoveryRuns";
  index: "by_need" | "by_plan" | "by_offer";
  parentKey: "needId" | "planId" | "offerId";
  limit: number;
  auditEntity?: string;
  deleteBlobs?: boolean;
  aggregate?: boolean;
  cancelWorkflow?: boolean;
};

async function scopedDocs(ctx: MutationCtx, table: CascadeChild["table"], index: CascadeChild["index"], key: CascadeChild["parentKey"], parentId: any, limit: number) {
  const rows: any[] = await (ctx.db.query as any)(table).withIndex(index, (q: any) => q.eq(key, parentId)).take(limit);
  return rows;
}

async function deleteScopedChildren(ctx: MutationCtx, spec: CascadeChild, parentId: any) {
  for (const row of await scopedDocs(ctx, spec.table, spec.index, spec.parentKey, parentId, spec.limit)) {
    if (spec.auditEntity) await deleteAudit(ctx, spec.auditEntity, String(row._id));
    if (spec.deleteBlobs) await ctx.storage.delete(row.storageId);
    if (spec.aggregate) await offersByNeed.deleteIfExists(ctx, row);
    if (spec.cancelWorkflow) {
      const status = await getStatus(ctx, components.workflow, row.workflowId as any);
      if (status.type === "inProgress") await cancel(ctx, components.workflow, row.workflowId as any);
    }
    await ctx.db.delete(row._id);
  }
}

const PLAN_CHILDREN: CascadeChild[] = [
  { table: "awardNotices", index: "by_plan", parentKey: "planId", limit: 100 },
  { table: "allocationLines", index: "by_plan", parentKey: "planId", limit: 200 },
  { table: "approvals", index: "by_plan", parentKey: "planId", limit: 10 },
];

const OFFER_CHILDREN: CascadeChild[] = [
  { table: "sourceChecks", index: "by_offer", parentKey: "offerId", limit: 100 },
  { table: "evidenceAttachments", index: "by_offer", parentKey: "offerId", limit: 20, deleteBlobs: true },
  { table: "offerVersions", index: "by_offer", parentKey: "offerId", limit: 500 },
];

const NEED_CHILDREN: CascadeChild[] = [
  { table: "rfqThreads", index: "by_need", parentKey: "needId", limit: 100, auditEntity: "rfqThreads" },
  { table: "inboxes", index: "by_need", parentKey: "needId", limit: 5 },
  { table: "inboxClaims", index: "by_need", parentKey: "needId", limit: 2 },
  { table: "deliveries", index: "by_need", parentKey: "needId", limit: 100 },
  { table: "holdNotices", index: "by_need", parentKey: "needId", limit: 100 },
  { table: "recoveryRuns", index: "by_need", parentKey: "needId", limit: 20, cancelWorkflow: true },
  { table: "offerVersions", index: "by_need", parentKey: "needId", limit: 500 },
];

async function deleteDemoIncident(ctx: MutationCtx, incidentId: any) {
  const needs = await ctx.db
    .query("needs")
    .withIndex("by_incident", (q) => q.eq("incidentId", incidentId))
    .take(10);

  for (const need of needs) {
    for (const plan of await scopedDocs(ctx, "allocationPlans", "by_need", "needId", need._id, 100)) {
      for (const spec of PLAN_CHILDREN) await deleteScopedChildren(ctx, spec, plan._id);
      await deleteAudit(ctx, "allocationPlans", String(plan._id));
      await ctx.db.delete(plan._id);
    }

    for (const offer of await scopedDocs(ctx, "offers", "by_need", "needId", need._id, 200)) {
      for (const spec of OFFER_CHILDREN) await deleteScopedChildren(ctx, spec, offer._id);
      await deleteAudit(ctx, "offers", String(offer._id));
      await offersByNeed.deleteIfExists(ctx, offer);
      await ctx.db.delete(offer._id);
    }

    for (const spec of NEED_CHILDREN) await deleteScopedChildren(ctx, spec, need._id);
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

  const offers: Array<{ supplierName: string; qty: number }> = [];
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
    offers.push({ supplierName: supplierFixtures[index].name, qty: fixture.qty });
  }

  // The fixture plan is minted through the same transactional recompute as
  // live plans, so its hash, reasons, and audits can never desynchronize.
  const result = await recomputeAllocation(ctx, needId, {
    supersedeApproved: false,
    allowEmpty: true,
    lineReason: "selected: cheapest feasible covering",
  });
  if (!result.planId) throw new Error("Demo fixture produced no plan");
  const planId = result.planId;

  const bulletin = await ctx.db.query("demoBulletins").withIndex("by_owner_and_key", (q) => q.eq("ownerId", ownerId).eq("key", "filter-nsf53")).unique();
  const bulletinValue = { title: "Northstar Filter Model NF-53 Safety Bulletin", state: "CLEAR" as const, body: "No active safety notices for model NF-53.", updatedAt: now };
  if (bulletin) await ctx.db.patch(bulletin._id, bulletinValue);
  else await ctx.db.insert("demoBulletins", { key: "filter-nsf53", ownerId, ...bulletinValue });

  const snapshotBase = { incident: { id: String(incidentId), title: DEMO_TITLE }, need: { id: String(needId), item: "Portable water filters (NSF/ANSI 53)", qty: 100 } };
  const snapshotOffers = (certStatus: string) => offers.map((offer) => ({ supplier: offer.supplierName, qty: offer.qty, certStatus }));
  await writeAudit(ctx, {
    entity: "incidents", entityId: incidentId, action: "demo_need_created", actor: "judge-mode", incidentId,
    snapshot: buildDriftSnapshot({ ...snapshotBase, offers: [], plan: null }),
  });
  await writeAudit(ctx, {
    entity: "incidents", entityId: incidentId, action: "demo_replies_received", actor: "judge-mode", incidentId,
    snapshot: buildDriftSnapshot({ ...snapshotBase, offers: snapshotOffers("needs_review"), plan: null }),
  });
  await writeAudit(ctx, {
    entity: "incidents", entityId: incidentId, action: "demo_sources_verified", actor: "judge-mode", incidentId,
    snapshot: buildDriftSnapshot({ ...snapshotBase, offers: snapshotOffers("verified"), plan: null }),
  });
  await writeAudit(ctx, {
    entity: "incidents", entityId: incidentId, action: "demo_plan_proposed", actor: "allocator", incidentId,
    snapshot: buildDriftSnapshot({ ...snapshotBase, offers: snapshotOffers("verified"), plan: { id: String(planId), coverage: result.totalQty, costCents: result.totalCostCents, suppliers: result.selected.map((offer) => offer.supplierName) } }),
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
