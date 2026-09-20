"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { replyAgentMailMessage, resolveAgentMail, sendAgentMailMessage } from "../lib/agentmail";
import { guardedProviderSend, IDEMPOTENCY_WINDOW_MS } from "../lib/sendGuard";
import { recordRun } from "../lib/runs";

export const sendAwardNotices = internalAction({
  args: { planId: v.id("allocationPlans") },
  returns: v.object({ sent: v.number(), skipped: v.number(), failed: v.number() }),
  handler: async (ctx, args) => {
    const dispatch: any = await ctx.runQuery(internal.awardNotices.getDispatch, args);
    if (!dispatch) return { sent: 0, skipped: 0, failed: 0 };
    const mail = resolveAgentMail();
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    let recoveryScheduled = false;
    const ensureRecovery = async (delay: number) => {
      if (recoveryScheduled) return;
      await ctx.scheduler.runAfter(delay, internal.actions.awards.sendAwardNotices, { planId: args.planId });
      recoveryScheduled = true;
    };
    for (const row of dispatch.threads) {
      if (!row.supplier) continue;
      const kind = row.allocatedQty > 0 ? "award" as const : "decline" as const;
      const claim = await ctx.runMutation(internal.awardNotices.claimNotice, {
        planId: args.planId,
        threadId: row.thread._id,
        kind,
      });
      const dispatchKey = `award-${String(args.planId)}-${String(row.thread._id)}-${kind}`;
      if (claim.shouldReconcile && claim.sendClaimedAt && Date.now() - claim.sendClaimedAt >= IDEMPOTENCY_WINDOW_MS) {
        await recordRun(ctx, {
          provider: "agentmail",
          operation: kind === "award" ? "send_award" : "send_decline",
          status: "failed",
          requestId: String(claim.noticeId),
          meta: JSON.stringify({ error: "Award notice requires manual review after provider idempotency window expired" }),
          ownerId: dispatch.ownerId ?? undefined,
        });
        failed++;
        continue;
      }
      if (!claim.shouldSend && !claim.shouldReconcile) {
        skipped++;
        continue;
      }
      await ensureRecovery(60_000);
      const text = kind === "award"
        ? `Your offer has been selected for ${row.allocatedQty} units of ${dispatch.need.item}. Please reply to acknowledge availability and dispatch timing.`
        : `Thank you for quoting ${dispatch.need.item}. Another offer was selected for this requirement.`;
      // Each row goes through the shared send guard: stale rejection,
      // provider send with claim release plus failed run on failure, finish
      // step, live run. Awards intentionally skip rate limiting so an
      // approved plan's notices are never throttled mid-dispatch.
      try {
        await guardedProviderSend(ctx, {
          ownerId: dispatch.ownerId ?? undefined,
          rateLimit: null,
          operation: kind === "award" ? "send_award" : "send_decline",
          failureRequestId: String(claim.noticeId),
          liveRun: (s) => ({ requestId: s.threadId }),
          claim: { reconcile: claim.shouldReconcile, claimedAt: claim.sendClaimedAt },
          releaseClaim: () => ctx.runMutation(internal.awardNotices.finishNotice, { noticeId: claim.noticeId, status: "failed" }),
          send: () => row.thread.agentmailMessageId && dispatch.inbox?.inboxId
            ? replyAgentMailMessage(mail, dispatch.inbox.inboxId, row.thread.agentmailMessageId, text, 20000, dispatchKey)
            : sendAgentMailMessage(mail, row.supplier.contactEmail, `${kind === "award" ? "Award" : "RFQ update"}: ${dispatch.need.item}`, text, 20000, dispatch.inbox?.inboxId, dispatchKey),
          finish: (_c, s) => ctx.runMutation(internal.awardNotices.finishNotice, { noticeId: claim.noticeId, status: "sent", messageId: s.messageId }),
        });
        sent++;
      } catch {
        failed++;
      }
    }
    return { sent, skipped, failed };
  },
});
