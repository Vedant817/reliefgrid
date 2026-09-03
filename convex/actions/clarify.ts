"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { chatJson, resolveLlmProvider } from "../lib/llm";
import { resolveAgentMail, sendAgentMailMessage } from "../lib/agentmail";

type OfferForClarification = {
  _id: string;
  needId: string;
  supplierId: string;
  qty: number;
  unitPriceCents: number;
  arrivalAt: number;
  certStatus: string;
  confidence: number;
  fieldEvidence?: Record<string, { confidence: number }>;
};

function unresolvedFields(offer: OfferForClarification) {
  const unresolved = new Set<string>();
  if (offer.qty <= 0) unresolved.add("quantity");
  if (offer.unitPriceCents <= 0) unresolved.add("unit price");
  if (offer.arrivalAt <= Date.now()) unresolved.add("arrival date and time");
  if (offer.certStatus !== "verified") unresolved.add("certification status");
  for (const [field, evidence] of Object.entries(offer.fieldEvidence ?? {})) {
    if (evidence.confidence < 0.75) unresolved.add(field === "price" ? "unit price" : field === "arrival" ? "arrival date and time" : field === "cert" ? "certification status" : "quantity");
  }
  if (offer.confidence < 0.75 && unresolved.size === 0) unresolved.add("offer terms");
  return [...unresolved];
}

export const draftClarification = action({
  args: { offerId: v.id("offers") },
  returns: v.object({
    question: v.string(),
    unresolved: v.array(v.string()),
    providerStatus: v.literal("live"),
  }),
  handler: async (ctx, args): Promise<{ question: string; unresolved: string[]; providerStatus: "live" }> => {
    const startedAt = Date.now();
    const offer = await ctx.runQuery(internal.offers.getOfferForClarification, { offerId: args.offerId });
    if (!offer) throw new Error("Offer not found");
    const unresolved = unresolvedFields(offer);
    if (unresolved.length === 0) throw new Error("This offer does not need clarification");
    const llm = resolveLlmProvider();
    if (llm.kind === "mock") throw new Error("no LLM key configured (GROQ_API_KEY or OPENAI_API_KEY)");
    let reply;
    try {
      reply = await chatJson(
        llm,
        {
          system:
            "You write one short supplier-clarification question for emergency procurement. " +
            "Ask ONLY about the listed unresolved details, naming each explicitly. Plain text, no greeting, no markdown.",
          user: `Unresolved offer details: ${unresolved.join(", ")}.`,
        },
        20000,
        false,
      );
    } catch (e) {
      await ctx.runMutation(api.health.recordProviderRun, {
        provider: llm.kind,
        operation: "draft_targeted_clarification",
        status: "failed",
        latencyMs: Date.now() - startedAt,
        requestId: String(args.offerId),
        meta: JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }),
      });
      throw e;
    }
    const question = reply.content.trim();
    if (!question) throw new Error("empty clarification from model");
    await ctx.runMutation(api.health.recordProviderRun, {
      provider: llm.kind,
      operation: "draft_targeted_clarification",
      status: "live",
      latencyMs: reply.latencyMs,
      requestId: reply.requestId,
      meta: JSON.stringify({ unresolved }),
    });
    return { question, unresolved, providerStatus: "live" as const };
  },
});

export const approveAndSendClarification = action({
  args: { offerId: v.id("offers"), approvedBy: v.string() },
  returns: v.object({
    question: v.string(),
    threadId: v.id("rfqThreads"),
    agentmailThreadId: v.string(),
    providerStatus: v.literal("live"),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ question: string; threadId: Id<"rfqThreads">; agentmailThreadId: string; providerStatus: "live" }> => {
    const offer = await ctx.runQuery(internal.offers.getOfferForClarification, { offerId: args.offerId });
    if (!offer) throw new Error("Offer not found");
    const unresolved = unresolvedFields(offer);
    if (unresolved.length === 0) throw new Error("This offer does not need clarification");
    const llm = resolveLlmProvider();
    if (llm.kind === "mock") throw new Error("no LLM key configured (GROQ_API_KEY or OPENAI_API_KEY)");
    const mail = resolveAgentMail();
    if (!mail.apiKey) throw new Error("no AgentMail key configured (AGENTMAIL_API_KEY)");
    const reply = await chatJson(
      llm,
      {
        system:
          "You write one short supplier-clarification question for emergency procurement. " +
          "Ask ONLY about the listed unresolved details, naming each explicitly. Plain text, no greeting, no markdown.",
        user: `Unresolved offer details: ${unresolved.join(", ")}.`,
      },
      20000,
      false,
    );
    const question = reply.content.trim();
    if (!question) throw new Error("empty clarification from model");
    const sent = await sendAgentMailMessage(mail, mail.inboxId, `Clarification needed: ${unresolved.join(", ")}`, question);
    const threads: Array<{ _id: Id<"rfqThreads">; supplierId: Id<"suppliers"> }> = await ctx.runQuery(api.rfq.listThreadsByNeed, { needId: offer.needId });
    const thread = threads.find((candidate) => candidate.supplierId === offer.supplierId);
    if (!thread) throw new Error("Supplier thread not found");
    await ctx.runMutation(api.rfq.updateThreadStatus, { threadId: thread._id, status: "clarification_sent" });
    await ctx.runMutation(api.health.recordProviderRun, {
      provider: "agentmail",
      operation: "send_clarification",
      status: "live",
      latencyMs: sent.latencyMs,
      requestId: sent.threadId,
      meta: JSON.stringify({ approvedBy: args.approvedBy, unresolved, questionRequestId: reply.requestId }),
    });
    return { question, threadId: thread._id, agentmailThreadId: sent.threadId, providerStatus: "live" as const };
  },
});
