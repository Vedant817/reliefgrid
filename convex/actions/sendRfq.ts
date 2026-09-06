"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { buildRfqEmail, resolveAgentMail, sendAgentMailMessage } from "../lib/agentmail";
import { guardedProviderSend, IDEMPOTENCY_WINDOW_MS } from "../lib/sendGuard";

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
    const dispatchKey = `rfq-${String(args.threadId)}`;
    const { subject, text } = buildRfqEmail(data.need, data.supplier.name);
    const { sent } = await guardedProviderSend(ctx, {
      ownerId: identity.tokenIdentifier,
      rateLimit: data.reconcile ? null : { name: "sendRfq", key: String(args.threadId) },
      operation: "send_rfq",
      failureRequestId: String(args.threadId),
      liveRun: (s) => ({ requestId: s.threadId }),
      claim: data,
      releaseClaim: (c) => ctx.runMutation(internal.rfq.releaseFreshRfqClaim, { threadId: args.threadId, claimedAt: c.claimedAt as number }),
      staleAfterMs: IDEMPOTENCY_WINDOW_MS,
      staleMessage: "RFQ send is older than the provider idempotency window and requires manual review",
      send: () => sendAgentMailMessage(mail, data.supplier.contactEmail, subject, text, 20000, data.inbox.inboxId, dispatchKey),
      finish: (_c, s) =>
        ctx.runMutation(internal.rfq.recordAgentMailSend, {
          threadId: args.threadId,
          agentmailThreadId: s.threadId,
          agentmailMessageId: s.messageId,
        }),
    });
    return { messageId: sent.messageId, threadId: sent.threadId, deduped: data.reconcile };
  },
});
