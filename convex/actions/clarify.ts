"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { chatJson, resolveLlmProvider } from "../lib/llm";
import { MIN_EVIDENCE_CONFIDENCE } from "../lib/allocate";
import { recordRun } from "../lib/runs";
import { replyAgentMailMessage, resolveAgentMail } from "../lib/agentmail";
import { guardedProviderSend, IDEMPOTENCY_WINDOW_MS } from "../lib/sendGuard";
import { checkLimit } from "../rateLimits";

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
    if (evidence.confidence < MIN_EVIDENCE_CONFIDENCE) unresolved.add(field === "price" ? "unit price" : field === "arrival" ? "arrival date and time" : field === "cert" ? "certification status" : "quantity");
  }
  if (offer.confidence < MIN_EVIDENCE_CONFIDENCE && unresolved.size === 0) unresolved.add("offer terms");
  return [...unresolved];
}

async function dispatchHash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
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
    const offer = await ctx.runQuery(api.offers.getOfferForVerification, { offerId: args.offerId });
    if (!offer) throw new Error("Offer not found");
    await checkLimit(ctx, "draftClarification", String(args.offerId), offer.ownerId);
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
      await recordRun(ctx, {
        provider: llm.kind,
        operation: "draft_targeted_clarification",
        status: "failed",
        startedAt,
        requestId: String(args.offerId),
        meta: JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }),
        ownerId: offer.ownerId,
      });
      throw e;
    }
    const question = reply.content.trim();
    if (!question) throw new Error("empty clarification from model");
    await recordRun(ctx, {
      provider: llm.kind,
      operation: "draft_targeted_clarification",
      status: "live",
      startedAt,
      latencyMs: reply.latencyMs,
      requestId: reply.requestId,
      meta: JSON.stringify({ unresolved }),
      ownerId: offer.ownerId,
    });
    return { question, unresolved, providerStatus: "live" as const };
  },
});

export const approveAndSendClarification = action({
  args: { offerId: v.id("offers"), question: v.string() },
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
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");
    const offer = await ctx.runQuery(api.offers.getOfferForVerification, { offerId: args.offerId });
    if (!offer) throw new Error("Offer not found");
    const unresolved = unresolvedFields(offer);
    if (unresolved.length === 0) throw new Error("This offer does not need clarification");
    const question = args.question.trim();
    if (!question || question.length > 500) throw new Error("Approved clarification must be 1-500 characters");
    const mail = resolveAgentMail();
    if (!mail.apiKey) throw new Error("no AgentMail key configured (AGENTMAIL_API_KEY)");
    const threads: Array<{ _id: Id<"rfqThreads">; supplierId: Id<"suppliers">; agentmailMessageId?: string }> = await ctx.runQuery(api.rfq.listThreadsByNeed, { needId: offer.needId });
    const thread = threads.find((candidate) => candidate.supplierId === offer.supplierId);
    if (!thread?.agentmailMessageId) throw new Error("A sent supplier thread is required before clarification");
    const agentmailMessageId: string = thread.agentmailMessageId;
    const dispatchKey = `clarification-${String(thread._id)}-${await dispatchHash(question)}`;
    const claim: any = await ctx.runMutation(internal.rfq.claimClarificationSend, { threadId: thread._id, dispatchKey });
    const { sent } = await guardedProviderSend(ctx, {
      ownerId: identity.tokenIdentifier,
      rateLimit: claim.reconcile ? null : { name: "sendClarification", key: String(args.offerId) },
      operation: "send_clarification",
      failureRequestId: String(thread._id),
      liveRun: (s) => ({ requestId: s.threadId, meta: JSON.stringify({ approvedBy: identity.tokenIdentifier, unresolved }) }),
      claim,
      releaseClaim: (c: any) =>
        ctx.runMutation(internal.rfq.releaseFreshClarificationClaim, { threadId: thread._id, dispatchKey, claimedAt: c.claimedAt }),
      staleAfterMs: IDEMPOTENCY_WINDOW_MS,
      staleMessage: "Clarification send is older than the provider idempotency window and requires manual review",
      send: () => replyAgentMailMessage(mail, claim.inbox.inboxId, agentmailMessageId, question, 20000, dispatchKey),
      finish: () => ctx.runMutation(internal.rfq.updateThreadStatus, { threadId: thread._id, status: "clarification_sent" }),
    });
    return { question, threadId: thread._id, agentmailThreadId: sent.threadId, providerStatus: "live" as const };
  },
});
