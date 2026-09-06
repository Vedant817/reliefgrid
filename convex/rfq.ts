import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { requireNeedOwner, requireThreadOwner } from "./model/auth";
import { normalizeMailbox } from "./lib/agentmail";

export const getThreadForSend = internalQuery({
  args: { threadId: v.id("rfqThreads") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) return null;
    return {
      ...thread,
      need: await ctx.db.get(thread.needId),
      supplier: await ctx.db.get(thread.supplierId),
    };
  },
});

export const recordAgentMailSend = internalMutation({
  args: {
    threadId: v.id("rfqThreads"),
    agentmailThreadId: v.string(),
    agentmailMessageId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.status !== "sending") throw new Error("RFQ send was not claimed");
    await ctx.db.patch(args.threadId, {
      status: "sent",
      sentAt: Date.now(),
      agentmailThreadId: args.agentmailThreadId,
      agentmailMessageId: args.agentmailMessageId,
      sendClaimedAt: undefined,
    });
    return null;
  },
});

export const createRfqThreadsForNeed = mutation({
  args: {
    needId: v.id("needs"),
    supplierIds: v.array(v.id("suppliers")),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const { ownerId } = await requireNeedOwner(ctx, args.needId);
    if (args.supplierIds.length > 50) throw new Error("A maximum of 50 suppliers can be added at once");

    const threads = [];
    const current = await ctx.db
      .query("rfqThreads")
      .withIndex("by_need", (q) => q.eq("needId", args.needId))
      .take(101);
    if (current.length > 100) throw new Error("This need exceeds the 100-thread limit");
    let createdCount = 0;
    for (const supplierId of new Set(args.supplierIds)) {
      const supplier = await ctx.db.get(supplierId);
      if (!supplier || supplier.ownerId !== ownerId) continue;

      const already = await ctx.db
        .query("rfqThreads")
        .withIndex("by_need_and_supplier", (q) => q.eq("needId", args.needId).eq("supplierId", supplierId))
        .first();
      if (already) {
        threads.push(already);
        continue;
      }
      if (current.length + createdCount >= 100) throw new Error("A need can have at most 100 supplier threads");

      const id = await ctx.db.insert("rfqThreads", {
        needId: args.needId,
        supplierId,
        status: "pending",
      });
      const thread = await ctx.db.get(id);
      if (thread) threads.push(thread);
      createdCount++;

      const needForAudit = await ctx.db.get(args.needId);
      await writeAudit(ctx, {
        entity: "rfqThreads",
        entityId: id,
        action: "create",
        actor: "system",
        incidentId: needForAudit?.incidentId,
        meta: JSON.stringify({ supplierId, needId: args.needId }),
      });
    }

    // No provider run is recorded here: thread records are local until a
    // real send attaches provider IDs, so the ledger only stores real attempts.
    return threads;
  },
});

export const listThreadsByNeed = query({
  args: { needId: v.id("needs") },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    await requireNeedOwner(ctx, args.needId);
    const threads = await ctx.db
      .query("rfqThreads")
      .withIndex("by_need", (q) => q.eq("needId", args.needId))
      .take(100);
    // Enrich with supplier
    const enriched = await Promise.all(
      threads.map(async (t) => {
        const supplier = await ctx.db.get(t.supplierId);
        return { ...t, supplier };
      }),
    );
    return enriched;
  },
});

const threadStatus = v.union(
  v.literal("pending"),
  v.literal("sending"),
  v.literal("sent"),
  v.literal("replied"),
  v.literal("awarded"),
  v.literal("rejected"),
  v.literal("clarification_sending"),
  v.literal("clarification_sent"),
);

export const claimRfqSend = internalMutation({
  args: { threadId: v.id("rfqThreads") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { thread, need, ownerId } = await requireThreadOwner(ctx, args.threadId);
    if (thread.agentmailMessageId && thread.agentmailThreadId) {
      return { deduped: true, messageId: thread.agentmailMessageId, threadId: thread.agentmailThreadId };
    }
    const reconcile = thread.status === "sending";
    const supplier = await ctx.db.get(thread.supplierId);
    if (!supplier || supplier.ownerId !== ownerId) throw new Error("Supplier not found");
    if (normalizeMailbox(supplier.contactEmail)?.split("@")[1] === "synthetic.reliefgrid.test") {
      throw new Error("Controlled synthetic contacts cannot receive email");
    }
    const inbox = await ctx.db.query("inboxes").withIndex("by_need", (q) => q.eq("needId", thread.needId)).first();
    if (!inbox) throw new Error("Create the need inbox before sending RFQs");
    const claimedAt = thread.sendClaimedAt ?? Date.now();
    if (!reconcile) await ctx.db.patch(thread._id, { status: "sending", sendClaimedAt: claimedAt });
    return { deduped: false, reconcile, claimedAt, thread, need, supplier, inbox, ownerId };
  },
});

export const releaseFreshRfqClaim = internalMutation({
  args: { threadId: v.id("rfqThreads"), claimedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (thread?.status === "sending" && thread.sendClaimedAt === args.claimedAt) {
      await ctx.db.patch(args.threadId, { status: "pending", sendClaimedAt: undefined });
    }
    return null;
  },
});

export const claimClarificationSend = internalMutation({
  args: { threadId: v.id("rfqThreads"), dispatchKey: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { thread } = await requireThreadOwner(ctx, args.threadId);
    if (thread.status === "clarification_sending" && thread.pendingDispatchKey !== args.dispatchKey) {
      throw new Error("Another clarification send is already in progress");
    }
    if (!thread.agentmailMessageId) throw new Error("A sent RFQ is required before clarification");
    const inbox = await ctx.db.query("inboxes").withIndex("by_need", (q) => q.eq("needId", thread.needId)).first();
    if (!inbox) throw new Error("Need inbox not found");
    const reconcile = thread.status === "clarification_sending";
    const previousStatus = thread.previousStatus ?? thread.status;
    const claimedAt = thread.sendClaimedAt ?? Date.now();
    if (!reconcile) {
      await ctx.db.patch(thread._id, {
        status: "clarification_sending",
        previousStatus,
        pendingDispatchKey: args.dispatchKey,
        sendClaimedAt: claimedAt,
      });
    }
    return { thread, inbox, previousStatus, reconcile, dispatchKey: args.dispatchKey, claimedAt };
  },
});

export const releaseFreshClarificationClaim = internalMutation({
  args: { threadId: v.id("rfqThreads"), dispatchKey: v.string(), claimedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (thread?.status === "clarification_sending" && thread.pendingDispatchKey === args.dispatchKey && thread.sendClaimedAt === args.claimedAt) {
      await ctx.db.patch(args.threadId, {
        status: thread.previousStatus ?? "sent",
        pendingDispatchKey: undefined,
        previousStatus: undefined,
        sendClaimedAt: undefined,
      });
    }
    return null;
  },
});

export const updateThreadStatus = internalMutation({
  args: {
    threadId: v.id("rfqThreads"),
    status: threadStatus,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) throw new Error("Thread not found");
    await ctx.db.patch(args.threadId, {
      status: args.status,
      lastReplyAt: Date.now(),
      pendingDispatchKey: undefined,
      previousStatus: undefined,
      sendClaimedAt: undefined,
    });
    const need = await ctx.db.get(thread.needId);
    await writeAudit(ctx, {
      entity: "rfqThreads",
      entityId: args.threadId,
      action: `status:${args.status}`,
      actor: "system",
      incidentId: need?.incidentId,
    });
    return null;
  },
});
