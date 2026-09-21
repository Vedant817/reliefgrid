import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireNeedOwner } from "./model/auth";
import { offersByNeed } from "./offerTotals";
import { allocateOffers } from "./lib/allocate";
import { allocationInputHash } from "./lib/allocationHash";

// The one joined read behind a need workspace: the need, its offers fully
// enriched (supplier, source checks, attachments, eligibility flags) in the
// canonical verified-first order, its threads with suppliers, its latest
// plan with lines and approval, and live coverage totals. UI modules render
// this model instead of joining subscriptions client-side, so sort order,
// coverage precedence, and eligibility flags cannot drift between views.
export const getNeedWorkspace = query({
  args: { needId: v.id("needs") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { need, incident } = await requireNeedOwner(ctx, args.needId);

    const rawOffers = await ctx.db.query("offers").withIndex("by_need", (q) => q.eq("needId", args.needId)).take(200);
    const versions = await ctx.db.query("offerVersions").withIndex("by_need", (q) => q.eq("needId", args.needId)).take(500);
    const versionById = new Map(versions.map((version) => [String(version._id), version]));
    const supplierIds = [...new Set(rawOffers.map((o) => String(o.supplierId)))];
    const supplierDocs = await Promise.all(
      supplierIds.map(async (id) => ctx.db.get(id as any)),
    );
    const suppliersById = new Map(supplierDocs.filter(Boolean).map((s: any) => [String(s!._id), s]));

    const offers = (
      await Promise.all(
        rawOffers.map(async (o) => {
          const supplier = suppliersById.get(String(o.supplierId)) ?? null;
          const checks = await ctx.db.query("sourceChecks").withIndex("by_offer", (q) => q.eq("offerId", o._id)).take(20);
          const attachments = await ctx.db
            .query("evidenceAttachments")
            .withIndex("by_offer", (q) => q.eq("offerId", o._id))
            .take(20);
          return {
            ...o,
            supplier,
            sourceChecks: checks,
            rawBody: o.currentVersionId ? versionById.get(String(o.currentVersionId))?.rawBody : undefined,
            attachments: await Promise.all(
              attachments.map(async (row) => ({
                _id: row._id,
                name: row.name,
                url: await ctx.storage.getUrl(row.storageId),
                uploadedAt: row.uploadedAt,
              })),
            ),
            verified: checks.some((c) => c.status === "verified"),
            isLate: o.arrivalAt !== undefined && o.arrivalAt > need.deadlineAt,
            isVerified: o.certStatus === "verified",
            ambiguous: o.arrivalAt === undefined || o.certStatus === "needs_review" || o.confidence < 0.75,
          };
        }),
      )
    ).sort((a, b) => {
      const av = a.certStatus === "verified" ? 0 : 1;
      const bv = b.certStatus === "verified" ? 0 : 1;
      return av - bv || a.unitPriceCents - b.unitPriceCents;
    });

    const rawThreads = await ctx.db.query("rfqThreads").withIndex("by_need", (q) => q.eq("needId", args.needId)).take(100);
    const threads = rawThreads.map((t) => ({ ...t, supplier: suppliersById.get(String(t.supplierId)) ?? null }));

    const plan = await ctx.db
      .query("allocationPlans")
      .withIndex("by_need", (q) => q.eq("needId", args.needId))
      .order("desc")
      .first();
    let latestPlan = null;
    if (plan) {
      const lines = await ctx.db.query("allocationLines").withIndex("by_plan", (q) => q.eq("planId", plan._id)).take(200);
      const linesWithSupplier = await Promise.all(
        lines.map(async (l) => ({ ...l, supplier: suppliersById.get(String(l.supplierId)) ?? (await ctx.db.get(l.supplierId)) })),
      );
      const approval = await ctx.db.query("approvals").withIndex("by_plan", (q) => q.eq("planId", plan._id)).first();
      latestPlan = { ...plan, lines: linesWithSupplier, approval: approval ?? null };
    }

    const allocationInputs = rawOffers.map((offer) => ({
      offerId: offer._id,
      supplierId: offer.supplierId,
      supplierName: suppliersById.get(String(offer.supplierId))?.name ?? "Unknown supplier",
      qty: offer.qty,
      unitPriceCents: offer.unitPriceCents,
      arrivalAt: offer.arrivalAt,
      certStatus: offer.certStatus,
      confidence: offer.confidence,
      fieldEvidence: offer.fieldEvidence,
    }));
    const currentAllocation = allocateOffers(allocationInputs, need);
    const currentHash = allocationInputHash(need, allocationInputs);
    let approvalReadiness = { ready: false, reason: "Compute a current recommendation before approval" };
    let recommendationState: "none" | "infeasible" | "stale" | "ready" | "approved" = "none";
    if (plan?.status === "approved") {
      recommendationState = "approved";
      approvalReadiness = { ready: false, reason: "This plan is already approved" };
    } else if (plan?.status === "infeasible" || (plan && !currentAllocation.feasible)) {
      recommendationState = "infeasible";
      approvalReadiness = {
        ready: false,
        reason: currentAllocation.rejected[0]?.reason ?? "No eligible quotes cover the full requirement",
      };
    } else if (plan) {
      const expectedLines = currentAllocation.selected
        .map((offer) => `${offer.offerId}:${offer.qty}:${offer.qty * offer.unitPriceCents}`)
        .sort();
      const actualLines = (latestPlan?.lines ?? [])
        .map((line: any) => `${line.offerId}:${line.qty}:${line.costCents}`)
        .sort();
      const stale = plan.status !== "proposed"
        || plan.inputHash !== currentHash
        || plan.totalQty !== currentAllocation.totalQty
        || plan.totalCostCents !== currentAllocation.totalCostCents
        || JSON.stringify(expectedLines) !== JSON.stringify(actualLines);
      recommendationState = stale ? "stale" : "ready";
      approvalReadiness = stale
        ? { ready: false, reason: "Recommendation is out of date; recompute it before approval" }
        : { ready: true, reason: "Full coverage is current and ready for human approval" };
    }

    const [offerCount, totalQty] = await Promise.all([
      offersByNeed.count(ctx, { namespace: args.needId }),
      offersByNeed.sum(ctx, { namespace: args.needId }),
    ]);

    const inbox = await ctx.db.query("inboxes").withIndex("by_need", (q) => q.eq("needId", args.needId)).first();

    return {
      need,
      incident: { _id: incident._id, title: incident.title, status: incident.status, deadlineAt: incident.deadlineAt },
      offers,
      threads,
      latestPlan,
      recommendationState,
      approvalReadiness,
      coverage: { offerCount, totalQty },
      verifiedOfferCount: offers.filter((o) => o.verified).length,
      inbox: inbox ? { email: inbox.email, inboxId: inbox.inboxId } : null,
    };
  },
});
