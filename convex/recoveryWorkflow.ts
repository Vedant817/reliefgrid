import { v } from "convex/values";
import { WorkflowManager, getStatus, sendEvent } from "@convex-dev/workflow";
import { internalMutation, mutation, query } from "./_generated/server";
import { components, internal } from "./_generated/api";
import { writeAudit } from "./lib/audit";
import { requireNeedOwner } from "./model/auth";
import { offersByNeed } from "./offerTotals";
import { recomputeAllocation } from "./allocations";

export const recoveryManager = new WorkflowManager(components.workflow);

// Durable evidence-drift recovery. Unlike the one-shot demo mutations, every
// step here is retried and resumable, the workflow survives restarts, and the
// human approval gate pauses indefinitely without consuming resources.
export const driftRecovery = recoveryManager.define({
  args: { needId: v.id("needs") },
  returns: v.object({ recoveredQty: v.number() }),
  handler: async (step, args): Promise<{ recoveredQty: number }> => {
    await step.runMutation(internal.recoveryWorkflow.invalidateFailedOffers, { needId: args.needId });
    await step.runMutation(internal.recoveryWorkflow.draftRecoveryNotice, { needId: args.needId });
    // Human gate: the workflow sleeps here until a coordinator approves.
    await step.awaitEvent({ name: "recoveryApproved" });
    await step.runMutation(internal.recoveryWorkflow.createReplacement, { needId: args.needId });
    const after: any = await step.runMutation(internal.recoveryWorkflow.recomputeNeed, { needId: args.needId });
    return { recoveredQty: after.totalQty };
  },
});

export const invalidateFailedOffers = internalMutation({
  args: { needId: v.id("needs") },
  returns: v.object({ invalidated: v.number() }),
  handler: async (ctx, args) => {
    const offers = await ctx.db.query("offers").withIndex("by_need", (q) => q.eq("needId", args.needId)).take(200);
    let invalidated = 0;
    for (const offer of offers) {
      const checks = await ctx.db.query("sourceChecks").withIndex("by_offer", (q) => q.eq("offerId", offer._id)).take(100);
      if (checks.some((c) => c.status === "failed") && offer.certStatus !== "failed") {
        await ctx.db.patch(offer._id, { certStatus: "failed", updatedAt: Date.now() });
        invalidated++;
      }
    }
    return { invalidated };
  },
});

export const draftRecoveryNotice = internalMutation({
  args: { needId: v.id("needs") },
  returns: v.object({ noticeId: v.id("holdNotices") }),
  handler: async (ctx, args) => {
    const need = await ctx.db.get(args.needId);
    if (!need) throw new Error("Need not found");
    const offers = await ctx.db.query("offers").withIndex("by_need", (q) => q.eq("needId", args.needId)).take(200);
    const failed = offers.find((o) => o.certStatus === "failed");
    if (!failed) throw new Error("No failed offer to hold");
    const existing = await ctx.db.query("holdNotices").withIndex("by_need", (q) => q.eq("needId", args.needId)).take(100);
    for (const notice of existing) await ctx.db.delete(notice._id);
    const noticeId = await ctx.db.insert("holdNotices", {
      needId: args.needId,
      offerId: failed._id,
      status: "draft",
      subject: "HOLD: allocation pending evidence review (workflow)",
      body: "A source check failed for an allocated offer. The recovery workflow paused for human approval before replacement stock is ordered.",
      citationUrl: "/demo-bulletin",
      createdAt: Date.now(),
    });
    return { noticeId };
  },
});

export const createReplacement = internalMutation({
  args: { needId: v.id("needs") },
  returns: v.object({ created: v.boolean() }),
  handler: async (ctx, args) => {
    const need = await ctx.db.get(args.needId);
    if (!need) throw new Error("Need not found");
    const incident = await ctx.db.get(need.incidentId);
    if (!incident?.ownerId || !incident.isDemo) throw new Error("Synthetic recovery is available only in the controlled demo");
    const email = "rfq+delta@synthetic.reliefgrid.test";
    let supplier = await ctx.db.query("suppliers").withIndex("by_owner_and_email", (q) => q.eq("ownerId", incident.ownerId).eq("contactEmail", email)).unique();
    if (!supplier) {
      const id = await ctx.db.insert("suppliers", {
        name: "Delta Emergency Stock", contactEmail: email, region: "East", verified: true, ownerId: incident.ownerId, createdAt: Date.now(),
      });
      supplier = await ctx.db.get(id);
    }
    if (!supplier) throw new Error("Could not create replacement supplier");
    const current = await ctx.db.query("offers").withIndex("by_need", (q) => q.eq("needId", args.needId)).take(200);
    if (current.some((offer) => offer.supplierId === supplier!._id)) return { created: false };
    const offerId = await ctx.db.insert("offers", {
      needId: args.needId, supplierId: supplier._id, qty: 70, unitPriceCents: 1200,
      arrivalAt: Date.now() + 2 * 3600000, certStatus: "verified", conditions: [], confidence: 0.98,
      rawEmailId: "workflow-replacement", language: "en", status: "active", updatedAt: Date.now(),
    });
    await ctx.db.insert("sourceChecks", {
      offerId, url: "https://example.com/demo/delta-nsf53", quote: "Replacement lot verified by workflow",
      retrievedAt: Date.now(), status: "verified", reason: "Workflow replacement fixture", type: "recall",
    });
    const offer = await ctx.db.get(offerId);
    await offersByNeed.insert(ctx, offer!);
    return { created: true };
  },
});

export const recomputeNeed = internalMutation({
  args: { needId: v.id("needs") },
  returns: v.object({ planId: v.id("allocationPlans"), totalQty: v.number(), totalCostCents: v.number() }),
  handler: async (ctx, args) => {
    const result = await recomputeAllocation(ctx, args.needId, {
      supersedeApproved: true,
      allowEmpty: true,
      lineReason: "selected by recovery workflow",
    });
    if (!result.planId) throw new Error("Recovery recompute produced no plan");
    return { planId: result.planId, totalQty: result.totalQty, totalCostCents: result.totalCostCents };
  },
});

export const startRecovery = mutation({
  args: { needId: v.id("needs") },
  returns: v.object({ workflowId: v.string() }),
  handler: async (ctx, args): Promise<{ workflowId: string }> => {
    const { need, ownerId } = await requireNeedOwner(ctx, args.needId);
    const incident = await ctx.db.get(need.incidentId);
    if (!incident?.isDemo) throw new Error("Guided synthetic recovery is available only in the controlled demo");
    const existing = await ctx.db.query("recoveryRuns").withIndex("by_need", (q) => q.eq("needId", args.needId)).order("desc").first();
    if (existing) {
      const status = await getStatus(ctx, components.workflow, existing.workflowId as any);
      if (status.type === "inProgress") return { workflowId: existing.workflowId };
      await ctx.db.delete(existing._id);
    }
    const workflowId: string = await recoveryManager.start(ctx, internal.recoveryWorkflow.driftRecovery, {
      needId: args.needId,
    });
    await ctx.db.insert("recoveryRuns", { workflowId, needId: args.needId, startedBy: ownerId, startedAt: Date.now() });
    await writeAudit(ctx, {
      entity: "needs",
      entityId: args.needId,
      action: "recovery_workflow_started",
      actor: "coordinator",
      incidentId: need.incidentId,
      meta: JSON.stringify({ workflowId }),
    });
    return { workflowId: workflowId as unknown as string };
  },
});

export const recoveryStatus = query({
  args: { workflowId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const run = await ctx.db.query("recoveryRuns").withIndex("by_workflow", (q) => q.eq("workflowId", args.workflowId)).unique();
    if (!run) throw new Error("Recovery workflow not found");
    await requireNeedOwner(ctx, run.needId);
    return await getStatus(ctx, components.workflow, args.workflowId as any);
  },
});

export const approveRecovery = mutation({
  args: { workflowId: v.string() },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args) => {
    const run = await ctx.db.query("recoveryRuns").withIndex("by_workflow", (q) => q.eq("workflowId", args.workflowId)).unique();
    if (!run) throw new Error("Recovery workflow not found");
    await requireNeedOwner(ctx, run.needId);
    await sendEvent(ctx, components.workflow, {
      workflowId: args.workflowId as any,
      name: "recoveryApproved",
      validator: v.null(),
      value: null,
    });
    return { ok: true };
  },
});
