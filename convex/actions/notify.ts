"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { resolveAgentMail, sendAgentMailMessage } from "../lib/agentmail";

// Deadline digest email, scheduled by the watchdog cron. One email per run
// regardless of how many needs are at risk. Demo safety: addressed to the
// app inbox itself.
export const sendDeadlineDigest = internalAction({
  args: {
    items: v.array(
      v.object({
        needId: v.id("needs"),
        item: v.string(),
        qty: v.number(),
        deadlineAt: v.number(),
      }),
    ),
  },
  returns: v.object({ threadId: v.string(), providerStatus: v.literal("live") }),
  handler: async (
    ctx,
    args,
  ): Promise<{ threadId: string; providerStatus: "live" }> => {
    const mail = resolveAgentMail();
    if (!mail.apiKey) throw new Error("no AgentMail key configured (AGENTMAIL_API_KEY)");
    const lines = args.items.map(
      (item) =>
        `- ${item.qty}x ${item.item} due ${new Date(item.deadlineAt).toISOString()} (need ${item.needId as Id<"needs">})`,
    );
    const sent = await sendAgentMailMessage(
      mail,
      mail.inboxId,
      `ReliefGrid deadline digest: ${args.items.length} need(s) at risk`,
      `The following needs are due within two hours without feasible cover:\n\n${lines.join("\n")}\n\nThis is an automated watchdog digest; no goods were ordered.`,
    );
    await ctx.runMutation(api.health.recordProviderRun, {
      provider: "agentmail",
      operation: "send_deadline_digest",
      status: "live",
      latencyMs: sent.latencyMs,
      requestId: sent.threadId,
      meta: JSON.stringify({ needs: args.items.length }),
    });
    return { threadId: sent.threadId, providerStatus: "live" as const };
  },
});
