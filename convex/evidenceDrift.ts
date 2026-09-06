import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { allocateOffers } from "./lib/allocate";
import { writeAudit } from "./lib/audit";
import { offersByNeed } from "./offerTotals";
import { requireNeedOwner } from "./model/auth";
import { allocationInputHash } from "./lib/allocationHash";

const BULLETIN_KEY = "filter-nsf53";
const DEMO_TITLE = "Flood Shelter - North District";

async function recompute(ctx: MutationCtx, needId: Id<"needs">) {
  const need = await ctx.db.get(needId);
  if (!need) throw new Error("Need not found");
  const offers = await ctx.db.query("offers").withIndex("by_need", (q) => q.eq("needId", needId)).take(200);
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
  const plans = await ctx.db.query("allocationPlans").withIndex("by_need", (q) => q.eq("needId", needId)).take(100);
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
    inputHash: allocationInputHash(need, inputs),
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
    const ownerId = args.needId ? (await requireNeedOwner(ctx, args.needId)).ownerId : null;
    const bulletin = ownerId
      ? await ctx.db.query("demoBulletins").withIndex("by_owner_and_key", (q) => q.eq("ownerId", ownerId).eq("key", BULLETIN_KEY)).unique()
      : null;
    const notices = args.needId
      ? await ctx.db.query("holdNotices").withIndex("by_need", (q) => q.eq("needId", args.needId!)).order("desc").take(1)
      : [];
    const holdNotice = notices[0] ?? null;
    let canSendHoldNotice = false;
    if (holdNotice) {
      const offer = await ctx.db.get(holdNotice.offerId);
      const threads = await ctx.db.query("rfqThreads").withIndex("by_need", (q) => q.eq("needId", holdNotice.needId)).take(100);
      const inbox = await ctx.db.query("inboxes").withIndex("by_need", (q) => q.eq("needId", holdNotice.needId)).first();
      canSendHoldNotice = Boolean(offer && inbox && threads.some((thread) => thread.supplierId === offer.supplierId && thread.agentmailMessageId));
    }
    return { bulletin, holdNotice, canSendHoldNotice };
  },
});

export const getPublicBulletin = query({
  args: { bulletinId: v.id("demoBulletins") },
  returns: v.union(
    v.object({
      title: v.string(),
      state: v.string(),
      body: v.string(),
      updatedAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const bulletin = await ctx.db.get(args.bulletinId);
    if (!bulletin) return null;
    return { title: bulletin.title, state: bulletin.state, body: bulletin.body, updatedAt: bulletin.updatedAt };
  },
});

export const applyVerifiedRecall = internalMutation({
  args: { needId: v.id("needs"), sourceUrl: v.string(), quote: v.string(), contentHash: v.string() },
  returns: v.object({ planId: v.id("allocationPlans"), totalQty: v.number(), totalCostCents: v.number() }),
  handler: async (ctx, args) => {
    const need = await ctx.db.get(args.needId);
    if (!need) throw new Error("Need not found");
    const incident = await ctx.db.get(need.incidentId);
    if (!incident?.ownerId) throw new Error("Incident owner not found");
    if (!incident.isDemo) throw new Error("Controlled recall can only modify a demo incident");
    const apex = await ctx.db.query("suppliers").withIndex("by_owner_and_email", (q) => q.eq("ownerId", incident.ownerId).eq("contactEmail", "rfq+apex@synthetic.reliefgrid.test")).unique();
    if (!apex) throw new Error("Apex demo supplier not found");
    const offers = await ctx.db.query("offers").withIndex("by_need", (q) => q.eq("needId", need._id)).take(200);
    const offer = offers.find((candidate) => candidate.supplierId === apex._id);
    if (!offer) throw new Error("Apex demo offer not found");

    const citationUrl = args.sourceUrl;
    await ctx.db.insert("sourceChecks", {
      offerId: offer._id,
      url: citationUrl,
      quote: args.quote,
      retrievedAt: Date.now(),
      status: "failed",
      reason: "Controlled bulletin changed after initial verification",
      type: "recall",
      claim: "NF-53 recall status",
      sourceAuthority: "authoritative",
      contentHash: args.contentHash,
      matched: true,
    });
    await ctx.db.patch(offer._id, { certStatus: "failed", updatedAt: Date.now() });

    const existingNotices = await ctx.db.query("holdNotices").withIndex("by_need", (q) => q.eq("needId", need._id)).take(100);
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
    // No provider run is recorded here: the controlled bulletin is local-only
    // so this recheck is simulated, and the ledger only stores real attempts.
    // The invalidation itself is audited below.
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
  args: { needId: v.id("needs") },
  returns: v.object({ planId: v.id("allocationPlans"), totalQty: v.number(), totalCostCents: v.number() }),
  handler: async (ctx, args) => {
    const { need, ownerId } = await requireNeedOwner(ctx, args.needId);
    const incident = await ctx.db.get(need.incidentId);
    if (!incident?.isDemo) throw new Error("Synthetic replacement stock is available only in the controlled demo");
    const email = "rfq+delta@synthetic.reliefgrid.test";
    let supplier = await ctx.db.query("suppliers").withIndex("by_owner_and_email", (q) => q.eq("ownerId", ownerId).eq("contactEmail", email)).unique();
    if (!supplier) {
      const id = await ctx.db.insert("suppliers", { name: "Delta Emergency Stock", contactEmail: email, region: "East", verified: true, ownerId, createdAt: Date.now() });
      supplier = await ctx.db.get(id);
    }
    if (!supplier) throw new Error("Could not create replacement supplier");
    const current = await ctx.db.query("offers").withIndex("by_need", (q) => q.eq("needId", need._id)).take(200);
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
      const replacementDoc = await ctx.db.get(offerId);
      await offersByNeed.insert(ctx, replacementDoc!);
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

export const getHoldNoticeForApproval = internalQuery({
  args: { noticeId: v.id("holdNotices") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const notice = await ctx.db.get(args.noticeId);
    if (!notice) throw new Error("Hold notice not found");
    await requireNeedOwner(ctx, notice.needId);
    return notice;
  },
});

export const claimHoldNoticeSend = internalMutation({
  args: { noticeId: v.id("holdNotices") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const notice = await ctx.db.get(args.noticeId);
    if (!notice || (notice.status !== "draft" && notice.status !== "sending")) throw new Error("Draft hold notice not found or already sent");
    const { ownerId } = await requireNeedOwner(ctx, notice.needId);
    const offer = await ctx.db.get(notice.offerId);
    if (!offer || offer.needId !== notice.needId) throw new Error("Hold notice offer not found");
    const threads = await ctx.db.query("rfqThreads").withIndex("by_need", (q) => q.eq("needId", notice.needId)).take(100);
    const thread = threads.find((candidate) => candidate.supplierId === offer.supplierId);
    const inbox = await ctx.db.query("inboxes").withIndex("by_need", (q) => q.eq("needId", notice.needId)).first();
    if (!thread?.agentmailMessageId || !inbox) throw new Error("A sent supplier thread is required before sending a hold notice");
    const dispatchKey = notice.dispatchKey ?? `hold-${String(notice._id)}`;
    const reconcile = notice.status === "sending";
    const claimedAt = notice.sendClaimedAt ?? Date.now();
    if (!reconcile) await ctx.db.patch(notice._id, { status: "sending", dispatchKey, sendClaimedAt: claimedAt });
    return { notice, thread, inbox, ownerId, dispatchKey, reconcile, claimedAt };
  },
});

export const releaseFreshHoldNoticeClaim = internalMutation({
  args: { noticeId: v.id("holdNotices"), claimedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const notice = await ctx.db.get(args.noticeId);
    if (notice?.status === "sending" && notice.sendClaimedAt === args.claimedAt) {
      await ctx.db.patch(args.noticeId, { status: "draft", dispatchKey: undefined, sendClaimedAt: undefined });
    }
    return null;
  },
});

export const getBulletin = internalQuery({
  args: { bulletinId: v.id("demoBulletins") },
  returns: v.any(),
  handler: async (ctx, args) => await ctx.db.get(args.bulletinId),
});

export const setBulletinRecall = internalMutation({
  args: { needId: v.id("needs") },
  returns: v.id("demoBulletins"),
  handler: async (ctx, args) => {
    const need = await ctx.db.get(args.needId);
    if (!need) throw new Error("Need not found");
    const incident = await ctx.db.get(need.incidentId);
    if (!incident?.ownerId) throw new Error("Incident owner not found");
    if (!incident.isDemo) throw new Error("Controlled recall can only modify a demo incident");
    const bulletin = await ctx.db.query("demoBulletins").withIndex("by_owner_and_key", (q) => q.eq("ownerId", incident.ownerId).eq("key", BULLETIN_KEY)).unique();
    if (!bulletin) throw new Error("Reset Demo before running Evidence Drift");
    await ctx.db.patch(bulletin._id, {
      state: "RECALL_ACTIVE",
      body: "RECALL ACTIVE: model NF-53 lot A17 may fail contaminant reduction requirements. Stop distribution pending review.",
      updatedAt: Date.now(),
    });
    return bulletin._id;
  },
});

export const restoreBulletinClear = internalMutation({
  args: { bulletinId: v.id("demoBulletins") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const bulletin = await ctx.db.get(args.bulletinId);
    if (bulletin?.state === "RECALL_ACTIVE") {
      await ctx.db.patch(args.bulletinId, {
        state: "CLEAR",
        body: "No active safety notices for model NF-53.",
        updatedAt: Date.now(),
      });
    }
    return null;
  },
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
    if (!notice || notice.status !== "sending") throw new Error("Claimed hold notice not found");
    await ctx.db.patch(args.noticeId, {
      status: "sent",
      approvedAt: Date.now(),
      approvedBy: args.approvedBy,
      sendClaimedAt: undefined,
    });
    void args.agentmailThreadId;
    return null;
  },
});
