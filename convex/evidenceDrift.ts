import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { allocateOffers } from "./lib/allocate";
import { writeAudit } from "./lib/audit";

const BULLETIN_KEY = "filter-nsf53";
const DEMO_TITLE = "Flood Shelter - North District";

async function getDemoNeed(ctx: MutationCtx) {
  const incident = await ctx.db.query("incidents").withIndex("by_title", (q) => q.eq("title", DEMO_TITLE)).unique();
  if (!incident) throw new Error("Reset Demo before running Evidence Drift");
  const needs = await ctx.db.query("needs").withIndex("by_incident", (q) => q.eq("incidentId", incident._id)).collect();
  if (!needs[0]) throw new Error("Demo need not found");
  return needs[0];
}

async function recompute(ctx: MutationCtx, needId: Id<"needs">) {
  const need = await ctx.db.get(needId);
  if (!need) throw new Error("Need not found");
  const offers = await ctx.db.query("offers").withIndex("by_need", (q) => q.eq("needId", needId)).collect();
  const inputs = await Promise.all(offers.map(async (offer) => ({
    offerId: String(offer._id),
    supplierId: String(offer.supplierId),
    supplierName: (await ctx.db.get(offer.supplierId))?.name ?? "Unknown supplier",
    qty: offer.qty,
    unitPriceCents: offer.unitPriceCents,
    arrivalAt: offer.arrivalAt,
    certStatus: offer.certStatus,
    confidence: offer.confidence,
  })));
  const result = allocateOffers(inputs, need);
  const plans = await ctx.db.query("allocationPlans").withIndex("by_need", (q) => q.eq("needId", needId)).collect();
  for (const plan of plans) {
    if (plan.status === "proposed" || plan.status === "approved") await ctx.db.patch(plan._id, { status: "superseded" });
  }
  const planId = await ctx.db.insert("allocationPlans", {
    needId,
    status: "proposed",
    totalCostCents: result.totalCostCents,
    totalQty: result.totalQty,
    createdAt: Date.now(),
    decisionTrace: result.trace,
  });
  for (const selected of result.selected) {
    await ctx.db.insert("allocationLines", {
      planId,
      supplierId: selected.supplierId as Id<"suppliers">,
      offerId: selected.offerId as Id<"offers">,
      qty: selected.qty,
      costCents: selected.qty * selected.unitPriceCents,
      reason: "selected after evidence recheck",
    });
  }
  await ctx.db.patch(needId, { status: result.totalQty >= need.qty ? "planning" : "awaiting_responses" });
  return { planId, totalQty: result.totalQty, totalCostCents: result.totalCostCents };
}

export const getEvidenceDriftState = query({
  args: { needId: v.optional(v.id("needs")) },
  returns: v.any(),
  handler: async (ctx, args) => {
    const bulletin = await ctx.db.query("demoBulletins").withIndex("by_key", (q) => q.eq("key", BULLETIN_KEY)).unique();
    const notices = args.needId
      ? await ctx.db.query("holdNotices").withIndex("by_need", (q) => q.eq("needId", args.needId!)).order("desc").take(1)
      : [];
    return { bulletin, holdNotice: notices[0] ?? null };
  },
});

export const activateRecall = mutation({
  args: {},
  returns: v.object({ planId: v.id("allocationPlans"), totalQty: v.number(), totalCostCents: v.number() }),
  handler: async (ctx) => {
    const need = await getDemoNeed(ctx);
    const apex = await ctx.db.query("suppliers").withIndex("by_email", (q) => q.eq("contactEmail", "rfq+apex@synthetic.reliefgrid.test")).unique();
    if (!apex) throw new Error("Apex demo supplier not found");
    const offers = await ctx.db.query("offers").withIndex("by_need", (q) => q.eq("needId", need._id)).collect();
    const offer = offers.find((candidate) => candidate.supplierId === apex._id);
    if (!offer) throw new Error("Apex demo offer not found");

    const bulletin = await ctx.db.query("demoBulletins").withIndex("by_key", (q) => q.eq("key", BULLETIN_KEY)).unique();
    if (!bulletin) throw new Error("Demo bulletin not found");
    const citationUrl = "/demo-bulletin";
    await ctx.db.patch(bulletin._id, {
      state: "RECALL_ACTIVE",
      body: "RECALL ACTIVE: model NF-53 lot A17 may fail contaminant reduction requirements. Stop distribution pending review.",
      updatedAt: Date.now(),
    });
    await ctx.db.insert("sourceChecks", {
      offerId: offer._id,
      url: citationUrl,
      quote: "RECALL ACTIVE: model NF-53 lot A17 may fail contaminant reduction requirements.",
      retrievedAt: Date.now(),
      status: "failed",
      reason: "Controlled bulletin changed after initial verification",
      type: "recall",
    });
    await ctx.db.patch(offer._id, { certStatus: "failed", updatedAt: Date.now() });

    const existingNotices = await ctx.db.query("holdNotices").withIndex("by_need", (q) => q.eq("needId", need._id)).collect();
    for (const notice of existingNotices) await ctx.db.delete(notice._id);
    await ctx.db.insert("holdNotices", {
      needId: need._id,
      offerId: offer._id,
      status: "draft",
      subject: "HOLD: Apex NF-53 allocation pending recall review",
      body: "Do not dispatch the Apex NF-53 allocation. A manufacturer bulletin now reports an active recall. Human approval is required before this notice is sent.",
      citationUrl,
      createdAt: Date.now(),
    });
    await ctx.db.insert("providerRuns", {
      provider: "firecrawl",
      operation: "recheck_controlled_bulletin",
      status: "mock",
      latencyMs: 0,
      requestId: String(offer._id),
      at: Date.now(),
      meta: JSON.stringify({ state: "RECALL_ACTIVE", citationUrl }),
    });
    const result = await recompute(ctx, need._id);
    await writeAudit(ctx, {
      entity: "offers",
      entityId: offer._id,
      action: "invalidated_by_recall",
      actor: "evidence-monitor",
      meta: JSON.stringify({ citationUrl, previousCertStatus: "verified", nextCertStatus: "failed" }),
      incidentId: need.incidentId,
      snapshot: JSON.stringify({
        incident: { id: String(need.incidentId), title: DEMO_TITLE },
        need: { id: String(need._id), item: need.item, qty: need.qty },
        offers: [
          { supplier: "Apex Medical Supply", qty: offer.qty, certStatus: "failed" },
          { supplier: "Casa Suministros", qty: 30, certStatus: "verified" },
        ],
        plan: { id: String(result.planId), coverage: result.totalQty, costCents: result.totalCostCents, suppliers: ["Casa Suministros"] },
        causalDiff: "Source recall removed Apex; plan coverage changed 100 -> 30",
      }),
    });
    return result;
  },
});

export const addReplacementOffer = mutation({
  args: {},
  returns: v.object({ planId: v.id("allocationPlans"), totalQty: v.number(), totalCostCents: v.number() }),
  handler: async (ctx) => {
    const need = await getDemoNeed(ctx);
    const email = "rfq+delta@synthetic.reliefgrid.test";
    let supplier = await ctx.db.query("suppliers").withIndex("by_email", (q) => q.eq("contactEmail", email)).unique();
    if (!supplier) {
      const id = await ctx.db.insert("suppliers", { name: "Delta Emergency Stock", contactEmail: email, region: "East", verified: true, createdAt: Date.now() });
      supplier = await ctx.db.get(id);
    }
    if (!supplier) throw new Error("Could not create replacement supplier");
    const current = await ctx.db.query("offers").withIndex("by_need", (q) => q.eq("needId", need._id)).collect();
    const replacement = current.find((offer) => offer.supplierId === supplier!._id);
    if (!replacement) {
      const offerId = await ctx.db.insert("offers", {
        needId: need._id, supplierId: supplier._id, qty: 70, unitPriceCents: 1200,
        arrivalAt: Date.now() + 2 * 3600000, certStatus: "verified", conditions: [], confidence: 0.98,
        rawEmailId: "demo-replacement", language: "en", status: "active", updatedAt: Date.now(),
      });
      await ctx.db.insert("sourceChecks", {
        offerId, url: "https://example.com/demo/delta-nsf53", quote: "Replacement lot is not affected by bulletin",
        retrievedAt: Date.now(), status: "verified", reason: "Labeled synthetic replacement fixture", type: "recall",
      });
    }
    const result = await recompute(ctx, need._id);
    await writeAudit(ctx, {
      entity: "incidents", entityId: need.incidentId, action: "replacement_plan_proposed", actor: "allocator", incidentId: need.incidentId,
      snapshot: JSON.stringify({
        incident: { id: String(need.incidentId), title: DEMO_TITLE },
        need: { id: String(need._id), item: need.item, qty: need.qty },
        offers: [
          { supplier: "Apex Medical Supply", qty: 70, certStatus: "failed" },
          { supplier: "Casa Suministros", qty: 30, certStatus: "verified" },
          { supplier: "Delta Emergency Stock", qty: 70, certStatus: "verified" },
        ],
        plan: { id: String(result.planId), coverage: result.totalQty, costCents: result.totalCostCents, suppliers: ["Casa Suministros", "Delta Emergency Stock"] },
        causalDiff: "Replacement stock restored plan coverage 30 -> 100",
      }),
    });
    return result;
  },
});

export const getHoldNotice = internalQuery({
  args: { noticeId: v.id("holdNotices") },
  returns: v.any(),
  handler: async (ctx, args) => await ctx.db.get(args.noticeId),
});

export const markHoldNoticeSent = internalMutation({
  args: {
    noticeId: v.id("holdNotices"),
    approvedBy: v.string(),
    agentmailThreadId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const notice = await ctx.db.get(args.noticeId);
    if (!notice || notice.status !== "draft") throw new Error("Draft hold notice not found");
    await ctx.db.patch(args.noticeId, {
      status: "sent",
      approvedAt: Date.now(),
      approvedBy: args.approvedBy,
    });
    await ctx.db.insert("providerRuns", {
      provider: "agentmail",
      operation: "send_hold_notice",
      status: "live",
      latencyMs: 0,
      requestId: args.agentmailThreadId,
      at: Date.now(),
      meta: JSON.stringify({ approvedBy: args.approvedBy }),
    });
    return null;
  },
});
