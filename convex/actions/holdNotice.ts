"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { resolveAgentMail, sendAgentMailMessage } from "../lib/agentmail";

// Approval-gated live hold-notice send. There is no mock lane: without an
// AgentMail key, or on provider failure, this throws and the notice stays
// a draft. Demo safety: mail goes to the app inbox itself.
export const approveAndSendHoldNotice = action({
  args: { noticeId: v.id("holdNotices"), approvedBy: v.string() },
  returns: v.object({
    noticeId: v.id("holdNotices"),
    agentmailThreadId: v.string(),
    providerStatus: v.literal("live"),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ noticeId: Id<"holdNotices">; agentmailThreadId: string; providerStatus: "live" }> => {
    const approver = args.approvedBy.trim();
    if (approver.length < 2) throw new Error("approvedBy must identify the approver");
    const notice: any = await ctx.runQuery(internal.evidenceDrift.getHoldNotice, { noticeId: args.noticeId });
    if (!notice || notice.status !== "draft") throw new Error("Draft hold notice not found");
    const mail = resolveAgentMail();
    if (!mail.apiKey) throw new Error("no AgentMail key configured (AGENTMAIL_API_KEY)");
    const sent = await sendAgentMailMessage(mail, mail.inboxId, notice.subject, notice.body);
    await ctx.runMutation(internal.evidenceDrift.markHoldNoticeSent, {
      noticeId: args.noticeId,
      approvedBy: approver,
      agentmailThreadId: sent.threadId,
    });
    await ctx.runMutation(api.health.recordProviderRun, {
      provider: "agentmail",
      operation: "send_hold_notice",
      status: "live",
      latencyMs: sent.latencyMs,
      requestId: sent.threadId,
      meta: JSON.stringify({ approvedBy: approver }),
    });
    return { noticeId: args.noticeId, agentmailThreadId: sent.threadId, providerStatus: "live" as const };
  },
});
