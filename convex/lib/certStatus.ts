import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export type CertEvidence = {
  status: string;
  type: string;
  sourceAuthority?: "authoritative" | "supporting";
  matched?: boolean;
};

export type ResolvedCertStatus = "failed" | "verified" | "needs_review" | null;

// The single rule mapping evidence to offer eligibility. `null` means the
// evidence carries no verdict and the offer keeps its status. Authoritative
// recalls always win (recall precedence survives later certificate checks).
export function resolveCertStatus(
  evidence: CertEvidence,
  opts: { activeRecall: boolean },
): ResolvedCertStatus {
  if (opts.activeRecall) return "failed";
  if (evidence.type === "recall") {
    return evidence.status === "failed" &&
      evidence.sourceAuthority === "authoritative" &&
      evidence.matched === true
      ? "failed"
      : null;
  }
  if (evidence.type === "cert") {
    if (evidence.status === "verified") return "verified";
    if (evidence.status === "failed") return "failed";
    return "needs_review";
  }
  return null;
}

// Whether an authoritative, matched, failed recall check is on record for
// the offer. Every writer consults this before grading evidence.
export async function hasActiveRecall(
  ctx: QueryCtx | MutationCtx,
  offerId: Id<"offers">,
): Promise<boolean> {
  const hit = await ctx.db
    .query("sourceChecks")
    .withIndex("by_offer_recall_state", (q) =>
      q.eq("offerId", offerId).eq("type", "recall").eq("status", "failed").eq("sourceAuthority", "authoritative").eq("matched", true),
    )
    .first();
  return Boolean(hit);
}
