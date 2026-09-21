"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { replyAgentMailMessage, resolveAgentMail } from "../lib/agentmail";
import { guardedProviderSend, IDEMPOTENCY_WINDOW_MS } from "../lib/sendGuard";

// Approval-gated live hold-notice send. Without an AgentMail key, an
// established supplier thread, or a successful provider response, this
// throws and the notice remains a draft.
export const approveAndSendHoldNotice = action({
  args: { noticeId: v.id("holdNotices") },
  returns: v.object({
    noticeId: v.id("holdNotices"),
    agentmailThreadId: v.string(),
    providerStatus: v.literal("live"),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ noticeId: Id<"holdNotices">; agentmailThreadId: string; providerStatus: "live" }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");
    const approval: any = await ctx.runQuery(internal.evidenceDrift.getHoldNoticeForApproval, { noticeId: args.noticeId });
    const approver = identity.name ?? identity.tokenIdentifier;
    const mail = resolveAgentMail();
    if (!mail.apiKey) throw new Error("no AgentMail key configured (AGENTMAIL_API_KEY)");
    const claim: any = await ctx.runMutation(internal.evidenceDrift.claimHoldNoticeSend, { noticeId: args.noticeId });
    const notice = claim.notice;
    const { sent } = await guardedProviderSend(ctx, {
      ownerId: approval.ownerId,
      rateLimit: claim.reconcile ? null : { name: "sendHoldNotice", key: String(args.noticeId) },
      operation: "send_hold_notice",
      failureRequestId: String(args.noticeId),
      liveRun: (s) => ({ requestId: s.threadId, meta: JSON.stringify({ approvedBy: approver }) }),
      claim,
      releaseClaim: (c: any) =>
        ctx.runMutation(internal.evidenceDrift.releaseFreshHoldNoticeClaim, { noticeId: args.noticeId, claimedAt: c.claimedAt }),
      staleAfterMs: IDEMPOTENCY_WINDOW_MS,
      staleMessage: "Hold-notice send is older than the provider idempotency window and requires manual review",
      send: () =>
        replyAgentMailMessage(mail, claim.inbox.inboxId, claim.thread.agentmailMessageId, `${notice.subject}\n\n${notice.body}`, 20000, claim.dispatchKey),
      finish: (_c, s) =>
        ctx.runMutation(internal.evidenceDrift.markHoldNoticeSent, {
          noticeId: args.noticeId,
          approvedBy: approver,
          agentmailThreadId: s.threadId,
        }),
    });
    return { noticeId: args.noticeId, agentmailThreadId: sent.threadId, providerStatus: "live" as const };
  },
});
