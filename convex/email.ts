import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { normalizeMailbox } from "./lib/agentmail";
import { writeAudit } from "./lib/audit";

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
      for (const reference of refs) {
        match = await ctx.db
          .query("rfqThreads")
          .withIndex("by_agentmail_message", (q) => q.eq("agentmailMessageId", reference))
          .first();
        if (match) break;
      }
    }
    if (!match) return null;
    const text = args.message?.text ?? args.message?.extracted_text ?? "";
    if (!text.trim()) return null;
    const sender = normalizeMailbox(args.message?.from ?? args.message?.sender);
    const supplier = await ctx.db.get(match.supplierId);
    if (!supplier || sender !== normalizeMailbox(supplier.contactEmail)) return null;
    if (match.status === "awarded" || match.status === "rejected") {
      const need = await ctx.db.get(match.needId);
      await ctx.db.patch(match._id, { lastReplyAt: Date.now() });
      await writeAudit(ctx, {
        entity: "rfqThreads",
        entityId: match._id,
        action: "supplier_acknowledgment_received",
        actor: "supplier",
        incidentId: need?.incidentId,
        meta: JSON.stringify({ messageId: args.message?.message_id ?? args.eventId, terminalStatus: match.status }),
      });
      return null;
    }
    await ctx.scheduler.runAfter(0, internal.actions.extract.extractOfferFromEmail, {
      needId: match.needId,
      supplierId: match.supplierId,
      rawBody: text,
      rawEmailId: `agentmail-${args.message?.message_id ?? args.eventId}`,
      receivedAt: args.message?.timestamp ? Date.parse(args.message.timestamp) : Date.now(),
    });
    await ctx.db.patch(match._id, { status: "replied", lastReplyAt: Date.now() });
    return null;
  },
});
