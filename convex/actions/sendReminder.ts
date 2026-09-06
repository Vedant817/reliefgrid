"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { replyAgentMailMessage, resolveAgentMail } from "../lib/agentmail";
import { guardedProviderSend } from "../lib/sendGuard";

// Human-approved nudge for suppliers that received an RFQ but never
// replied. Sends in the existing AgentMail thread; threads that already
// have a reply, award, or rejection are rejected instead of re-mailed.
export const sendReminder = action({
  args: { threadId: v.id("rfqThreads") },
  returns: v.object({ threadId: v.string(), providerStatus: v.literal("live") }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");
    const detail: any = await ctx.runQuery(internal.rfq.getThreadForReminder, { threadId: args.threadId });
    const mail = resolveAgentMail();
    if (!mail.apiKey) throw new Error("no AgentMail key configured (AGENTMAIL_API_KEY)");
    const text = `Following up on our request for ${detail.need.qty} units of ${detail.need.item} (needed by ${new Date(detail.need.deadlineAt).toISOString()}). Please reply with quantity, unit price, delivery time, and certification status.`;
    const { sent } = await guardedProviderSend(ctx, {
      ownerId: detail.ownerId,
      rateLimit: { name: "sendReminder", key: String(args.threadId) },
      operation: "send_reminder",
      failureRequestId: String(args.threadId),
      liveRun: (s) => ({ requestId: s.threadId }),
      claim: null,
      send: () =>
        replyAgentMailMessage(
          mail, detail.inbox.inboxId, detail.thread.agentmailMessageId, text, 20000, `reminder-${String(args.threadId)}`,
        ),
    });
    return { threadId: sent.threadId, providerStatus: "live" as const };
  },
});
