"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

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

function buildQuestion(fields: string[]) {
  if (fields.length === 0) return "No clarification is required; all allocation fields are sufficiently supported.";
  if (fields.length === 1) return `Please confirm the exact ${fields[0]} for this offer.`;
  return `Please confirm only these unresolved offer details: ${fields.slice(0, -1).join(", ")} and ${fields[fields.length - 1]}.`;
}

export const draftClarification = action({
  args: { offerId: v.id("offers") },
  returns: v.object({ question: v.string(), unresolved: v.array(v.string()), providerStatus: v.literal("mock") }),
  handler: async (ctx, args): Promise<{ question: string; unresolved: string[]; providerStatus: "mock" }> => {
    const startedAt = Date.now();
    const offer = await ctx.runQuery(internal.offers.getOfferForClarification, { offerId: args.offerId });
    if (!offer) throw new Error("Offer not found");
    const unresolved = unresolvedFields(offer);
    const question = buildQuestion(unresolved);
    await ctx.runMutation(api.health.recordProviderRun, {
      provider: "openai",
      operation: "draft_targeted_clarification",
      status: "mock",
      latencyMs: Date.now() - startedAt,
      requestId: String(args.offerId),
      meta: JSON.stringify({ unresolved }),
    });
    return { question, unresolved, providerStatus: "mock" as const };
  },
});

export const approveAndSendClarification = action({
  args: { offerId: v.id("offers"), approvedBy: v.string() },
  returns: v.object({ question: v.string(), threadId: v.id("rfqThreads"), providerStatus: v.literal("mock") }),
  handler: async (ctx, args): Promise<{ question: string; threadId: Id<"rfqThreads">; providerStatus: "mock" }> => {
    const startedAt = Date.now();
    const offer = await ctx.runQuery(internal.offers.getOfferForClarification, { offerId: args.offerId });
    if (!offer) throw new Error("Offer not found");
    const unresolved = unresolvedFields(offer);
    if (unresolved.length === 0) throw new Error("This offer does not need clarification");
    const question = buildQuestion(unresolved);
    const threads: Array<{ _id: Id<"rfqThreads">; supplierId: Id<"suppliers"> }> = await ctx.runQuery(api.rfq.listThreadsByNeed, { needId: offer.needId });
    const thread = threads.find((candidate) => candidate.supplierId === offer.supplierId);
    if (!thread) throw new Error("Supplier thread not found");
    await ctx.runMutation(api.rfq.updateThreadStatus, { threadId: thread._id, status: "clarification_sent" });
    await ctx.runMutation(api.health.recordProviderRun, {
      provider: "agentmail",
      operation: "send_clarification",
      status: "mock",
      latencyMs: Date.now() - startedAt,
      requestId: String(thread._id),
      meta: JSON.stringify({ approvedBy: args.approvedBy, unresolved }),
    });
    return { question, threadId: thread._id, providerStatus: "mock" as const };
  },
});
