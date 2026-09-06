"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { replyAgentMailMessage, resolveAgentMail } from "../lib/agentmail";
import { checkLimit } from "../rateLimits";

// Approval-gated live hold-notice send. There is no mock lane: without an
// AgentMail key, or on provider failure, this throws and the notice stays
// a draft. Demo safety: mail goes to the app inbox itself.
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
    await ctx.runQuery(internal.evidenceDrift.getHoldNoticeForApproval, { noticeId: args.noticeId });
    const approver = identity.name ?? identity.tokenIdentifier;
    const mail = resolveAgentMail();
    if (!mail.apiKey) throw new Error("no AgentMail key configured (AGENTMAIL_API_KEY)");
    const claim: any = await ctx.runMutation(internal.evidenceDrift.claimHoldNoticeSend, { noticeId: args.noticeId });
    const notice = claim.notice;
    if (claim.reconcile && Date.now() - claim.claimedAt >= 23 * 60 * 60 * 1000) {
      throw new Error("Hold-notice send is older than the provider idempotency window and requires manual review");
    }
    if (!claim.reconcile) {
      try {
        await checkLimit(ctx, "sendHoldNotice", String(args.noticeId), identity.tokenIdentifier);
      } catch (error) {
        await ctx.runMutation(internal.evidenceDrift.releaseFreshHoldNoticeClaim, { noticeId: args.noticeId, claimedAt: claim.claimedAt });
        throw error;
      }
    }
    const sent = await replyAgentMailMessage(mail, claim.inbox.inboxId, claim.thread.agentmailMessageId, `${notice.subject}\n\n${notice.body}`, 20000, claim.dispatchKey);
    await ctx.runMutation(internal.evidenceDrift.markHoldNoticeSent, {
      noticeId: args.noticeId,
      approvedBy: approver,
      agentmailThreadId: sent.threadId,
    });
    await ctx.runMutation(internal.health.recordProviderRun, {
      provider: "agentmail",
      operation: "send_hold_notice",
      status: "live",
      latencyMs: sent.latencyMs,
      requestId: sent.threadId,
      meta: JSON.stringify({ approvedBy: approver }),
      ownerId: identity.tokenIdentifier,
    });
    return { noticeId: args.noticeId, agentmailThreadId: sent.threadId, providerStatus: "live" as const };
  },
});
