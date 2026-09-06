"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { buildRfqEmail, resolveAgentMail, sendAgentMailMessage } from "../lib/agentmail";
import { checkLimit } from "../rateLimits";

export const approveAndSendRfq = action({
  args: { threadId: v.id("rfqThreads") },
  returns: v.object({ messageId: v.string(), threadId: v.string(), deduped: v.boolean() }),
  handler: async (ctx, args): Promise<{ messageId: string; threadId: string; deduped: boolean }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");
    const mail = resolveAgentMail();
    if (!mail.apiKey) throw new Error("no AgentMail key configured (AGENTMAIL_API_KEY)");
    const data: any = await ctx.runMutation(internal.rfq.claimRfqSend, args);
    if (data.deduped) return { messageId: data.messageId, threadId: data.threadId, deduped: true };
    if (data.reconcile && Date.now() - data.claimedAt >= 23 * 60 * 60 * 1000) {
      throw new Error("RFQ send is older than the provider idempotency window and requires manual review");
    }
    if (!data.reconcile) {
      try {
        await checkLimit(ctx, "sendRfq", String(args.threadId), identity.tokenIdentifier);
      } catch (error) {
        await ctx.runMutation(internal.rfq.releaseFreshRfqClaim, { threadId: args.threadId, claimedAt: data.claimedAt });
        throw error;
      }
    }
    const dispatchKey = `rfq-${String(args.threadId)}`;
    const { subject, text } = buildRfqEmail(data.need, data.supplier.name);
    const sent = await sendAgentMailMessage(mail, data.supplier.contactEmail, subject, text, 20000, data.inbox.inboxId, dispatchKey);
    await ctx.runMutation(internal.rfq.recordAgentMailSend, {
      threadId: args.threadId,
      agentmailThreadId: sent.threadId,
      agentmailMessageId: sent.messageId,
    });
    await ctx.runMutation(internal.health.recordProviderRun, {
      provider: "agentmail",
      operation: "send_rfq",
      status: "live",
      latencyMs: sent.latencyMs,
      requestId: sent.threadId,
      ownerId: data.ownerId,
    });
    return { messageId: sent.messageId, threadId: sent.threadId, deduped: data.reconcile };
  },
});
