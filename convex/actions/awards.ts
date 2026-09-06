"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { normalizeMailbox, replyAgentMailMessage, resolveAgentMail, sendAgentMailMessage } from "../lib/agentmail";

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
      const contactDomain = normalizeMailbox(row.supplier.contactEmail)?.split("@")[1];
      const demo = dispatch.isDemo || contactDomain === "synthetic.reliefgrid.test";
      const claim = await ctx.runMutation(internal.awardNotices.claimNotice, {
        planId: args.planId,
        threadId: row.thread._id,
        kind,
        demo,
      });
      const dispatchKey = `award-${String(args.planId)}-${String(row.thread._id)}-${kind}`;
      if (claim.shouldReconcile && claim.sendClaimedAt && Date.now() - claim.sendClaimedAt >= 23 * 60 * 60 * 1000) {
        console.error("Award notice requires manual review after provider idempotency window expired", claim.noticeId);
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
      try {
        const result = row.thread.agentmailMessageId && dispatch.inbox?.inboxId
          ? await replyAgentMailMessage(mail, dispatch.inbox.inboxId, row.thread.agentmailMessageId, text, 20000, dispatchKey)
          : await sendAgentMailMessage(mail, row.supplier.contactEmail, `${kind === "award" ? "Award" : "RFQ update"}: ${dispatch.need.item}`, text, 20000, dispatch.inbox?.inboxId, dispatchKey);
        await ctx.runMutation(internal.awardNotices.finishNotice, { noticeId: claim.noticeId, status: "sent", messageId: result.messageId });
        sent++;
      } catch (error) {
        console.error(error);
        failed++;
      }
    }
    return { sent, skipped, failed };
  },
});
