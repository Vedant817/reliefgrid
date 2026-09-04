import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { api, components, internal } from "./_generated/api";
import { AgentMail } from "@agentmail/convex";
import { buildRfqEmail, resolveAgentMail } from "./lib/agentmail";
import { checkLimit } from "./rateLimits";

const agentmail: AgentMail = new AgentMail(components.agentmail, {
  onMessageReceived: internal.email.onInboundReply,
});

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
    const outboundId: string = await agentmail.sendMessage(ctx, mail.inboxId, {
      to: args.toOverride ?? mail.inboxId,
      subject,
      text,
      labels: ["reliefgrid-rfq"],
    });
    await ctx.db.patch(args.threadId, {
      status: "sent",
      sentAt: Date.now(),
      inboxId: mail.inboxId,
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
    return await agentmail.status(ctx, args.outboundId as any);
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
