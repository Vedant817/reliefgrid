import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

// Shared invalidation helpers for verified public evidence changes.

// Mirror already-failed source checks onto offer status (recovery sweep).
// Grades nothing: an offer is touched only when a failed check exists.
export async function failOffersWithFailedChecks(ctx: MutationCtx, needId: Id<"needs">): Promise<number> {
  const offers = await ctx.db.query("offers").withIndex("by_need", (q) => q.eq("needId", needId)).take(200);
  let invalidated = 0;
  for (const offer of offers) {
    const checks = await ctx.db.query("sourceChecks").withIndex("by_offer", (q) => q.eq("offerId", offer._id)).take(100);
    if (checks.some((c) => c.status === "failed") && offer.certStatus !== "failed") {
      await ctx.db.patch(offer._id, { certStatus: "failed", updatedAt: Date.now() });
      invalidated++;
    }
  }
  return invalidated;
}

// Replace the need's hold notices with a single draft.
export async function replaceHoldNotice(
  ctx: MutationCtx,
  args: { needId: Id<"needs">; offerId: Id<"offers">; subject: string; body: string; citationUrl: string },
): Promise<Id<"holdNotices">> {
  const existing = await ctx.db.query("holdNotices").withIndex("by_need", (q) => q.eq("needId", args.needId)).take(100);
  for (const notice of existing) await ctx.db.delete(notice._id);
  return await ctx.db.insert("holdNotices", {
    needId: args.needId,
    offerId: args.offerId,
    status: "draft",
    subject: args.subject,
    body: args.body,
    citationUrl: args.citationUrl,
    createdAt: Date.now(),
  });
}

export type DriftSnapshotOffer = { supplier: string; qty: number; certStatus: string };

// The audit snapshot envelope behind drift and approval. Optional sections
// stay in fixed positions so snapshots
// keep a stable shape no matter which writer mints them.
export function buildDriftSnapshot(args: {
  incident: { id: string; title?: string };
  need: { id: string; item: string; qty: number };
  offers?: DriftSnapshotOffer[];
  plan: { id: string; coverage: number; costCents: number; suppliers: string[] } | null;
  approvedBy?: string;
  approvedAt?: number;
  causalDiff?: string;
}): string {
  return JSON.stringify({
    incident: args.incident,
    need: args.need,
    ...(args.offers ? { offers: args.offers } : {}),
    plan: args.plan,
    ...(args.approvedBy ? { approvedBy: args.approvedBy } : {}),
    ...(args.approvedAt !== undefined ? { approvedAt: args.approvedAt } : {}),
    ...(args.causalDiff ? { causalDiff: args.causalDiff } : {}),
  });
}
