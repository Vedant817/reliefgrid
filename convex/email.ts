import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { api, components } from "./_generated/api";
import { getAgentMail } from "./agentmailClient";
import { buildRfqEmail, resolveAgentMail } from "./lib/agentmail";
import { checkLimit } from "./rateLimits";

function agentmail() {
  return getAgentMail();
}

// Sends a real RFQ through the AgentMail component: durable enqueue from the
// mutation, provider delivery with bounded retries in the workpool, and a
// live status trail. Replaces the hand-rolled fetch sender.
export const sendRfqViaComponent = mutation({
  args: { threadId: v.id("rfqThreads"), toOverride: v.optional(v.string()) },
  returns: v.object({ outboundId: v.string(), providerStatus: v.literal("live") }),
  handler: async (ctx, args) => {
    await checkLimit(ctx, "sendRfq", String(args.threadId));
    const thread = await ctx.db.get(args.threadId);
    if (!thread) throw new Error("Thread not found");
    const need = await ctx.db.get(thread.needId);
    const supplier = await ctx.db.get(thread.supplierId);
    if (!need || !supplier) throw new Error("Need or supplier not found");
    const mail = resolveAgentMail();
    if (!mail.apiKey) throw new Error("no AgentMail key configured (AGENTMAIL_API_KEY)");
    if (thread.agentmailMessageId && thread.agentmailThreadId) {
      return { outboundId: thread.agentmailMessageId, providerStatus: "live" as const };
    }
    const { subject, text } = buildRfqEmail(need, supplier.name);
    // Prefer the need's own real inbox; fall back to the default sender.
    const mapped = await ctx.db
      .query("inboxes")
      .withIndex("by_need", (q) => q.eq("needId", thread.needId))
      .first();
    const senderInbox = mapped?.inboxId ?? mail.inboxId;
    const outboundId: string = await agentmail().sendMessage(ctx, senderInbox, {
      to: args.toOverride ?? mail.inboxId,
      subject,
      text,
      labels: ["reliefgrid-rfq"],
    });
    await ctx.db.patch(args.threadId, {
      status: "sent",
      sentAt: Date.now(),
      inboxId: senderInbox,
      agentmailMessageId: outboundId,
    });
    await ctx.db.insert("providerRuns", {
      provider: "agentmail",
      operation: "send_rfq",
      status: "live",
      requestId: outboundId,
      at: Date.now(),
      meta: JSON.stringify({ supplier: supplier.name, via: "component" }),
    });
    return { outboundId, providerStatus: "live" as const };
  },
});

// Delivery status for a component send (pending → sent → delivered/...).
export const sendStatus = query({
  args: { outboundId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await agentmail().status(ctx, args.outboundId as any);
  },
});

// Reactive inbox thread view, synced by the component webhook.
export const listComponentThread = query({
  args: { threadId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.agentmail.lib.listInboundMessages, { threadId: args.threadId });
  },
});

// Recent inbound mail for an inbox, as synced by the webhook ingest.
export const listInboxMessages = query({
  args: { inboxId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.agentmail.lib.listInboundMessages, {
      inboxId: args.inboxId,
    });
  },
});

// Inbound reply handler, invoked by the component after Svix verification and
// event dedup. Links the reply thread back to our RFQ thread and schedules
// live extraction, closing the send → reply → offer loop.
export const onInboundReply = internalMutation({
  args: { message: v.any(), thread: v.any(), eventId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const threadId = args.thread?.thread_id ?? args.message?.thread_id;
    const refs: string[] = [
      ...(args.message?.in_reply_to ? [args.message.in_reply_to] : []),
      ...(args.thread?.references ?? []),
    ];
    let match = null;
    if (threadId) {
      match = await ctx.db
        .query("rfqThreads")
        .withIndex("by_agentmail_thread", (q) => q.eq("agentmailThreadId", threadId))
        .first();
    }
    if (!match && refs.length > 0) {
      const candidates = await ctx.db.query("rfqThreads").collect();
      match = candidates.find((t) => t.agentmailMessageId && refs.some((r) => r.includes(t.agentmailMessageId!))) ?? null;
    }
    if (!match) return null;
    const text = args.message?.text ?? args.message?.extracted_text ?? "";
    if (!text.trim()) return null;
    await ctx.scheduler.runAfter(0, api.actions.extract.extractOfferFromEmail, {
      needId: match.needId,
      supplierId: match.supplierId,
      rawBody: text,
      rawEmailId: `agentmail-${args.message?.message_id ?? args.eventId}`,
    });
    await ctx.db.patch(match._id, { status: "replied", lastReplyAt: Date.now() });
    return null;
  },
});
