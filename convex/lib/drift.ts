import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { offersByNeed } from "../offerTotals";

// Shared invalidation writer behind every evidence-drift path (controlled
// recall, public recall, guided recovery, demo fixtures). One place owns
// the sweep, the hold-notice churn, the synthetic replacement, and the
// audit snapshot envelope — callers pass only what differs.

export const DELTA_SUPPLIER = {
  name: "Delta Emergency Stock",
  contactEmail: "rfq+delta@synthetic.reliefgrid.test",
  region: "East",
} as const;

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

// Idempotent synthetic Delta replacement offer shared by the demo
// replacement and the guided-recovery replacement.
export async function ensureDeltaReplacement(
  ctx: MutationCtx,
  args: { needId: Id<"needs">; ownerId: string; rawEmailId: string; quote: string; reason: string },
): Promise<{ offerId: Id<"offers">; created: boolean }> {
  let supplier = await ctx.db
    .query("suppliers")
    .withIndex("by_owner_and_email", (q) => q.eq("ownerId", args.ownerId).eq("contactEmail", DELTA_SUPPLIER.contactEmail))
    .unique();
  if (!supplier) {
    const id = await ctx.db.insert("suppliers", {
      name: DELTA_SUPPLIER.name,
      contactEmail: DELTA_SUPPLIER.contactEmail,
      region: DELTA_SUPPLIER.region,
      verified: true,
      ownerId: args.ownerId,
      createdAt: Date.now(),
    });
    supplier = await ctx.db.get(id);
  }
  if (!supplier) throw new Error("Could not create replacement supplier");
  const current = await ctx.db.query("offers").withIndex("by_need", (q) => q.eq("needId", args.needId)).take(200);
  const existing = current.find((offer) => offer.supplierId === supplier!._id);
  if (existing) return { offerId: existing._id, created: false };
  const offerId = await ctx.db.insert("offers", {
    needId: args.needId,
    supplierId: supplier._id,
    qty: 70,
    unitPriceCents: 1200,
    arrivalAt: Date.now() + 2 * 3600000,
    certStatus: "verified",
    conditions: [],
    confidence: 0.98,
    rawEmailId: args.rawEmailId,
    language: "en",
    status: "active",
    updatedAt: Date.now(),
  });
  await ctx.db.insert("sourceChecks", {
    offerId,
    url: "https://example.com/demo/delta-nsf53",
    quote: args.quote,
    retrievedAt: Date.now(),
    status: "verified",
    reason: args.reason,
    type: "recall",
  });
  const offer = await ctx.db.get(offerId);
  await offersByNeed.insert(ctx, offer!);
  return { offerId, created: true };
}

export type DriftSnapshotOffer = { supplier: string; qty: number; certStatus: string };

// The one audit snapshot envelope behind drift, recovery, approval, and
// demo fixtures. Optional sections stay in fixed positions so snapshots
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
