import { v } from "convex/values";
import { WorkflowManager, getStatus, sendEvent } from "@convex-dev/workflow";
import { internalMutation, mutation, query } from "./_generated/server";
import { api, components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { allocateOffers } from "./lib/allocate";
import { writeAudit } from "./lib/audit";

export const recoveryManager = new WorkflowManager(components.workflow);

// Durable evidence-drift recovery. Unlike the one-shot demo mutations, every
// step here is retried and resumable, the workflow survives restarts, and the
// human approval gate pauses indefinitely without consuming resources.
export const driftRecovery = recoveryManager.define({
  args: { needId: v.id("needs") },
  returns: v.object({ recoveredQty: v.number() }),
  handler: async (step, args): Promise<{ recoveredQty: number }> => {
    const before: any = await step.runQuery(api.allocations.getLatestPlan, { needId: args.needId });
    void before;
    await step.runMutation(internal.recoveryWorkflow.invalidateFailedOffers, { needId: args.needId });
    await step.runMutation(internal.recoveryWorkflow.draftRecoveryNotice, { needId: args.needId });
    // Human gate: the workflow sleeps here until a coordinator approves.
    await step.awaitEvent({ name: "recoveryApproved" });
    await step.runMutation(internal.recoveryWorkflow.createReplacement, { needId: args.needId });
    const after: any = await step.runMutation(internal.recoveryWorkflow.recomputeNeed, { needId: args.needId });
    return { recoveredQty: after.totalQty };
  },
});

async function recomputeForNeed(ctx: any, needId: Id<"needs">) {
  const need = await ctx.db.get(needId);
  if (!need) throw new Error("Need not found");
  const offers = await ctx.db.query("offers").withIndex("by_need", (q: any) => q.eq("needId", needId)).collect();
  const inputs = await Promise.all(
    offers.map(async (offer: any) => ({
      offerId: String(offer._id),
      supplierId: String(offer.supplierId),
      supplierName: (await ctx.db.get(offer.supplierId))?.name ?? "Unknown supplier",
      qty: offer.qty,
      unitPriceCents: offer.unitPriceCents,
      arrivalAt: offer.arrivalAt,
      certStatus: offer.certStatus,
      confidence: offer.confidence,
      fieldEvidence: offer.fieldEvidence,
    })),
  );
  const result = allocateOffers(inputs, need);
  const plans = await ctx.db.query("allocationPlans").withIndex("by_need", (q: any) => q.eq("needId", needId)).collect();
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
    inputHash: JSON.stringify({ workflow: true, at: Date.now() }),
  });
  for (const selected of result.selected) {
    await ctx.db.insert("allocationLines", {
      planId,
      supplierId: selected.supplierId as Id<"suppliers">,
      offerId: selected.offerId as Id<"offers">,
      qty: selected.qty,
      costCents: selected.qty * selected.unitPriceCents,
      reason: "selected by recovery workflow",
    });
  }
  await ctx.db.patch(needId, { status: result.totalQty >= need.qty ? "planning" : "awaiting_responses" });
  return { planId, totalQty: result.totalQty, totalCostCents: result.totalCostCents };
}

export const invalidateFailedOffers = internalMutation({
  args: { needId: v.id("needs") },
  returns: v.object({ invalidated: v.number() }),
  handler: async (ctx, args) => {
    const offers = await ctx.db.query("offers").withIndex("by_need", (q) => q.eq("needId", args.needId)).collect();
    let invalidated = 0;
    for (const offer of offers) {
      const checks = await ctx.db.query("sourceChecks").withIndex("by_offer", (q) => q.eq("offerId", offer._id)).collect();
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
    const offers = await ctx.db.query("offers").withIndex("by_need", (q) => q.eq("needId", args.needId)).collect();
    const failed = offers.find((o) => o.certStatus === "failed");
    if (!failed) throw new Error("No failed offer to hold");
    const existing = await ctx.db.query("holdNotices").withIndex("by_need", (q) => q.eq("needId", args.needId)).collect();
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
    const email = "rfq+delta@synthetic.reliefgrid.test";
    let supplier = await ctx.db.query("suppliers").withIndex("by_email", (q) => q.eq("contactEmail", email)).unique();
    if (!supplier) {
      const id = await ctx.db.insert("suppliers", {
        name: "Delta Emergency Stock", contactEmail: email, region: "East", verified: true, createdAt: Date.now(),
      });
      supplier = await ctx.db.get(id);
    }
    if (!supplier) throw new Error("Could not create replacement supplier");
    const current = await ctx.db.query("offers").withIndex("by_need", (q) => q.eq("needId", args.needId)).collect();
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
    return { created: true };
  },
});

export const recomputeNeed = internalMutation({
  args: { needId: v.id("needs") },
  returns: v.object({ planId: v.id("allocationPlans"), totalQty: v.number(), totalCostCents: v.number() }),
  handler: async (ctx, args) => recomputeForNeed(ctx, args.needId),
});

export const startRecovery = mutation({
  args: { needId: v.id("needs") },
  returns: v.object({ workflowId: v.string() }),
  handler: async (ctx, args): Promise<{ workflowId: string }> => {
    const workflowId: string = await recoveryManager.start(ctx, internal.recoveryWorkflow.driftRecovery, {
      needId: args.needId,
    });
    await writeAudit(ctx, {
      entity: "needs",
      entityId: args.needId,
      action: "recovery_workflow_started",
      actor: "coordinator",
      incidentId: (await ctx.db.get(args.needId))?.incidentId,
      meta: JSON.stringify({ workflowId }),
    });
    return { workflowId: workflowId as unknown as string };
  },
});

export const recoveryStatus = query({
  args: { workflowId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await getStatus(ctx, components.workflow, args.workflowId as any);
  },
});

export const approveRecovery = mutation({
  args: { workflowId: v.string() },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args) => {
    await sendEvent(ctx, components.workflow, {
      workflowId: args.workflowId as any,
      name: "recoveryApproved",
      validator: v.null(),
      value: null,
    });
    return { ok: true };
  },
});
