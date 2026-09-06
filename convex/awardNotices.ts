import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const getDispatch = internalQuery({
  args: { planId: v.id("allocationPlans") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const plan = await ctx.db.get(args.planId);
    if (!plan || plan.status !== "approved") return null;
    const need = await ctx.db.get(plan.needId);
    if (!need) throw new Error("Need not found");
    const incident = await ctx.db.get(need.incidentId);
    if (!incident) throw new Error("Incident not found");
    const lines = await ctx.db.query("allocationLines").withIndex("by_plan", (q) => q.eq("planId", args.planId)).take(100);
    const selected = new Map(lines.map((line) => [String(line.supplierId), line.qty]));
    const threads = await ctx.db.query("rfqThreads").withIndex("by_need", (q) => q.eq("needId", plan.needId)).take(100);
    const inbox = await ctx.db.query("inboxes").withIndex("by_need", (q) => q.eq("needId", plan.needId)).first();
    return {
      need,
      isDemo: incident.isDemo === true,
      inbox,
      threads: await Promise.all(threads.map(async (thread) => ({
        thread,
        supplier: await ctx.db.get(thread.supplierId),
        allocatedQty: selected.get(String(thread.supplierId)) ?? 0,
      }))),
    };
  },
});

export const claimNotice = internalMutation({
  args: {
    planId: v.id("allocationPlans"),
    threadId: v.id("rfqThreads"),
    kind: v.union(v.literal("award"), v.literal("decline")),
    demo: v.boolean(),
  },
  returns: v.object({ noticeId: v.id("awardNotices"), shouldSend: v.boolean(), shouldReconcile: v.boolean(), sendClaimedAt: v.optional(v.number()) }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("awardNotices")
      .withIndex("by_plan_thread_kind", (q) => q.eq("planId", args.planId).eq("threadId", args.threadId).eq("kind", args.kind))
      .first();
    if (existing?.status === "sending") {
      return { noticeId: existing._id, shouldSend: false, shouldReconcile: true, sendClaimedAt: existing.sendClaimedAt };
    }
    if (existing && existing.status !== "failed") return { noticeId: existing._id, shouldSend: false, shouldReconcile: false, sendClaimedAt: existing.sendClaimedAt };
    if (existing) {
      const sendClaimedAt = Date.now();
      await ctx.db.patch(existing._id, { status: args.demo ? "skipped_demo" : "sending", error: undefined, updatedAt: sendClaimedAt, sendClaimedAt });
      return { noticeId: existing._id, shouldSend: !args.demo, shouldReconcile: false, sendClaimedAt };
    }
    const sendClaimedAt = Date.now();
    const noticeId = await ctx.db.insert("awardNotices", {
      planId: args.planId,
      threadId: args.threadId,
      kind: args.kind,
      status: args.demo ? "skipped_demo" : "sending",
      updatedAt: sendClaimedAt,
      sendClaimedAt,
    });
    return { noticeId, shouldSend: !args.demo, shouldReconcile: false, sendClaimedAt };
  },
});

export const finishNotice = internalMutation({
  args: {
    noticeId: v.id("awardNotices"),
    status: v.union(v.literal("sent"), v.literal("failed")),
    messageId: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.noticeId, { status: args.status, messageId: args.messageId, error: args.error, updatedAt: Date.now(), sendClaimedAt: undefined });
    return null;
  },
});
