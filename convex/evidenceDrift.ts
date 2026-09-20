import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { writeAudit } from "./lib/audit";
import { buildDriftSnapshot, replaceHoldNotice } from "./lib/drift";
import { requireNeedOwner } from "./model/auth";
import { recomputeAllocation } from "./allocations";

export const getEvidenceDriftState = query({
  args: { needId: v.optional(v.id("needs")) },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (args.needId) await requireNeedOwner(ctx, args.needId);
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
    return { holdNotice, canSendHoldNotice };
  },
});

// A confirmed authoritative recall invalidates matching offers, drafts a hold
// notice, recomputes the plan, and records the change in one transaction.
export const applyPublicRecall = internalMutation({
  args: { needId: v.id("needs"), offerIds: v.array(v.id("offers")), sourceUrl: v.string(), quote: v.string(), contentHash: v.string() },
  returns: v.object({ planId: v.id("allocationPlans"), totalQty: v.number(), totalCostCents: v.number(), invalidated: v.number() }),
  handler: async (ctx, args) => {
    const need = await ctx.db.get(args.needId);
    if (!need) throw new Error("Need not found");
    const incident = await ctx.db.get(need.incidentId);
    if (!incident?.ownerId) throw new Error("Incident owner not found");
    const invalidated: { id: Id<"offers">; supplierName: string; previousCertStatus: string }[] = [];
    for (const offerId of new Set(args.offerIds)) {
      const offer = await ctx.db.get(offerId);
      if (!offer || offer.needId !== need._id) throw new Error("Offer not found");
      if (offer.certStatus === "failed") continue;
      await ctx.runMutation(internal.sourceChecks.addSourceCheck, {
        offerId: offer._id,
        url: args.sourceUrl,
        quote: args.quote,
        status: "failed",
        reason: "Public recall source conflicts with the offer",
        type: "recall",
        claim: need.certRequired ?? need.item,
        sourceAuthority: "authoritative",
        contentHash: args.contentHash,
        matched: true,
      });
      const supplier = await ctx.db.get(offer.supplierId);
      invalidated.push({ id: offer._id, supplierName: supplier?.name ?? "Unknown supplier", previousCertStatus: offer.certStatus });
    }
    if (!invalidated.length) throw new Error("All matching offers are already invalidated");

    await replaceHoldNotice(ctx, {
      needId: need._id,
      offerId: invalidated[0].id,
      subject: "HOLD: allocation pending recall review",
      body: `Do not dispatch the ${invalidated.map((offer) => offer.supplierName).join(", ")} allocation. A public recall source reports a matching recall. Human approval is required before this notice is sent.`,
      citationUrl: args.sourceUrl,
    });
    const result = await recomputeAllocation(ctx, need._id, {
      supersedeApproved: true,
      allowEmpty: true,
      lineReason: "selected after evidence recheck",
    });
    if (!result.planId) throw new Error("Evidence recheck produced no plan");
    await writeAudit(ctx, {
      entity: "offers",
      entityId: String(invalidated[0].id),
      action: "invalidated_by_recall",
      actor: "evidence-monitor",
      meta: JSON.stringify({ citationUrl: args.sourceUrl, invalidated: invalidated.map((offer) => String(offer.id)), nextCertStatus: "failed" }),
      incidentId: need.incidentId,
      snapshot: buildDriftSnapshot({
        incident: { id: String(need.incidentId), title: incident.title },
        need: { id: String(need._id), item: need.item, qty: need.qty },
        plan: { id: String(result.planId), coverage: result.totalQty, costCents: result.totalCostCents, suppliers: [] },
      }),
    });
    return { planId: result.planId, totalQty: result.totalQty, totalCostCents: result.totalCostCents, invalidated: invalidated.length };
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

export const markHoldNoticeSent = internalMutation({
  args: { noticeId: v.id("holdNotices"), approvedBy: v.string(), agentmailThreadId: v.string() },
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
