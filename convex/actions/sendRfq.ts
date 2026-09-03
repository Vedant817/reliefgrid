"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { buildRfqEmail, resolveAgentMail, sendAgentMailMessage } from "../lib/agentmail";

// Sends a real RFQ email through the configured AgentMail inbox and links the
// provider thread/message IDs onto the rfqThread. Idempotent: a thread that
// already carries provider IDs is returned without re-sending.
// Demo safety: mail is addressed to the app inbox itself unless a real
// supplier address is explicitly passed, so no external party is mailed.
export const sendRfqEmail = action({
  args: {
    threadId: v.id("rfqThreads"),
    toOverride: v.optional(v.string()),
  },
  returns: v.object({
    threadId: v.id("rfqThreads"),
    agentmailThreadId: v.string(),
    agentmailMessageId: v.string(),
    providerStatus: v.union(v.literal("live"), v.literal("mock")),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    threadId: any;
    agentmailThreadId: string;
    agentmailMessageId: string;
    providerStatus: "live" | "mock";
  }> => {
    const startedAt = Date.now();
    const thread: any = await ctx.runQuery(internal.rfq.getThreadForSend, { threadId: args.threadId });
    if (!thread?.need || !thread?.supplier) throw new Error("Thread, need, or supplier not found");
    if (thread.agentmailThreadId && thread.agentmailMessageId) {
      return {
        threadId: args.threadId,
        agentmailThreadId: thread.agentmailThreadId,
        agentmailMessageId: thread.agentmailMessageId,
        providerStatus: "live" as const,
      };
    }
    const mail = resolveAgentMail();
    const { subject, text } = buildRfqEmail(thread.need, thread.supplier.name);
    if (!mail.apiKey) {
      await ctx.runMutation(api.health.recordProviderRun, {
        provider: "agentmail",
        operation: "send_rfq",
        status: "mock",
        latencyMs: Date.now() - startedAt,
        requestId: String(args.threadId),
        meta: JSON.stringify({ reason: "no key" }),
      });
      return {
        threadId: args.threadId,
        agentmailThreadId: thread.threadId ?? "synthetic",
        agentmailMessageId: "synthetic",
        providerStatus: "mock" as const,
      };
    }
    const to = args.toOverride ?? mail.inboxId;
    const sent = await sendAgentMailMessage(mail, to, subject, text);
    await ctx.runMutation(internal.rfq.recordAgentMailSend, {
      threadId: args.threadId,
      agentmailThreadId: sent.threadId,
      agentmailMessageId: sent.messageId,
    });
    await ctx.runMutation(api.health.recordProviderRun, {
      provider: "agentmail",
      operation: "send_rfq",
      status: "live",
      latencyMs: sent.latencyMs,
      requestId: sent.threadId,
      meta: JSON.stringify({ to, supplier: thread.supplier.name }),
    });
    return {
      threadId: args.threadId,
      agentmailThreadId: sent.threadId,
      agentmailMessageId: sent.messageId,
      providerStatus: "live" as const,
    };
  },
});
