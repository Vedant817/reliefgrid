import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { hasActiveRecall } from "./lib/certStatus";
import { offersByNeed } from "./offerTotals";
import { requireNeedOwner, requireOfferOwner, supplierBelongsTo } from "./model/auth";

const evidenceSpan = v.object({ confidence: v.number(), start: v.number(), end: v.number(), quote: v.string() });
const fieldEvidence = v.object({ qty: evidenceSpan, price: evidenceSpan, arrival: evidenceSpan, cert: evidenceSpan });

export const getExtractionContext = internalQuery({
  args: { needId: v.id("needs"), supplierId: v.id("suppliers") },
  returns: v.object({
    ownerId: v.string(),
    item: v.string(),
    certRequired: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const need = await ctx.db.get(args.needId);
    const supplier = await ctx.db.get(args.supplierId);
    if (!need || !supplier) throw new Error("Extraction context not found");
    const incident = await ctx.db.get(need.incidentId);
    if (!incident?.ownerId || !supplierBelongsTo(supplier, incident.ownerId)) throw new Error("Supplier does not belong to the incident owner");
    return { ownerId: incident.ownerId, item: need.item, certRequired: need.certRequired };
  },
});

export const upsertOfferVersion = internalMutation({
  args: {
    needId: v.id("needs"),
    supplierId: v.id("suppliers"),
    qty: v.number(),
    unitPriceCents: v.number(),
    arrivalAt: v.number(),
    certStatus: v.string(),
    conditions: v.array(v.string()),
    confidence: v.number(),
    fieldEvidence: v.optional(fieldEvidence),
    rawEmailId: v.string(),
    rawBody: v.string(),
    language: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.qty < 0) throw new Error("qty must be >= 0");
    if (args.unitPriceCents < 0) throw new Error("unitPriceCents must be >= 0");
    if (!args.rawEmailId.trim()) throw new Error("rawEmailId must not be empty");
    const need = await ctx.db.get(args.needId);
    if (!need) throw new Error("Need not found");
    if (args.conditions.length > 50 || args.conditions.some((condition) => condition.length > 500)) throw new Error("Offer conditions exceed limits");
    const existingOffer = await ctx.db
      .query("offers")
      .withIndex("by_need_and_supplier", (q) => q.eq("needId", args.needId).eq("supplierId", args.supplierId))
      .first();
    const activeRecall = existingOffer ? await hasActiveRecall(ctx, existingOffer._id) : false;
    const certStatus = activeRecall ? "failed" : args.certStatus;

    // Replay guard: same email seen before must carry identical terms.
    const sameEmail = await ctx.db
      .query("offerVersions")
      .withIndex("by_need_supplier_email", (q) => q.eq("needId", args.needId).eq("supplierId", args.supplierId).eq("rawEmailId", args.rawEmailId))
      .first();
    if (sameEmail) {
      const identical =
        sameEmail.qty === args.qty &&
        sameEmail.unitPriceCents === args.unitPriceCents &&
        sameEmail.arrivalAt === args.arrivalAt &&
        sameEmail.certStatus === certStatus;
      if (!identical) throw new Error("duplicate email with divergent terms rejected");
      if (existingOffer) return existingOffer._id;
    }

    if (!existingOffer) {
      const offerCount = (await ctx.db.query("offers").withIndex("by_need", (q) => q.eq("needId", args.needId)).take(200)).length;
      if (offerCount >= 200) throw new Error("This need has reached the 200-offer limit");
    } else {
      const versionCount = (await ctx.db.query("offerVersions").withIndex("by_offer", (q) => q.eq("offerId", existingOffer._id)).take(500)).length;
      if (versionCount >= 500) throw new Error("This offer has reached the 500-version history limit");
    }

    // Create version
    const versionId = await ctx.db.insert("offerVersions", {
      needId: args.needId,
      supplierId: args.supplierId,
      qty: args.qty,
      unitPriceCents: args.unitPriceCents,
      arrivalAt: args.arrivalAt,
      certStatus,
      conditions: args.conditions,
      confidence: args.confidence,
      fieldEvidence: args.fieldEvidence,
      previousVersionId: existingOffer?.currentVersionId,
      rawEmailId: args.rawEmailId,
      rawBody: args.rawBody,
      language: args.language,
      createdAt: Date.now(),
    });

    if (existingOffer) {
      await ctx.db.patch(existingOffer._id, {
        qty: args.qty,
        unitPriceCents: args.unitPriceCents,
        arrivalAt: args.arrivalAt,
        certStatus,
        conditions: args.conditions,
        confidence: args.confidence,
        fieldEvidence: args.fieldEvidence,
        currentVersionId: versionId,
        rawEmailId: args.rawEmailId,
        language: args.language,
        updatedAt: Date.now(),
        status: "active",
      });
      const newDoc = await ctx.db.get(existingOffer._id);
      await offersByNeed.replace(ctx, existingOffer, newDoc!);
      // Link version to offer
      await ctx.db.patch(versionId, { offerId: existingOffer._id });

      await writeAudit(ctx, {
        entity: "offers",
        entityId: existingOffer._id,
        action: "update_version",
        actor: "system",
        incidentId: need.incidentId,
        meta: JSON.stringify({ versionId, qty: args.qty }),
      });
      return existingOffer._id;
    } else {
      const offerId = await ctx.db.insert("offers", {
        needId: args.needId,
        supplierId: args.supplierId,
        qty: args.qty,
        unitPriceCents: args.unitPriceCents,
        arrivalAt: args.arrivalAt,
        certStatus,
        conditions: args.conditions,
        confidence: args.confidence,
        fieldEvidence: args.fieldEvidence,
        currentVersionId: versionId,
        rawEmailId: args.rawEmailId,
        language: args.language,
        status: "active",
        updatedAt: Date.now(),
      });
      await ctx.db.patch(versionId, { offerId });
      const created = await ctx.db.get(offerId);
      await offersByNeed.insert(ctx, created!);
      await writeAudit(ctx, {
        entity: "offers",
        entityId: offerId,
        action: "create",
        actor: "system",
        incidentId: need.incidentId,
        meta: JSON.stringify({ versionId }),
      });
      return offerId;
    }
  },
});

export const listOffersByNeed = query({
  args: { needId: v.id("needs") },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    await requireNeedOwner(ctx, args.needId);
    const offers = await ctx.db
      .query("offers")
      .withIndex("by_need", (q) => q.eq("needId", args.needId))
      .take(200);
    const enriched = await Promise.all(
      offers.map(async (o) => {
        const supplier = await ctx.db.get(o.supplierId);
        const version = o.currentVersionId ? await ctx.db.get(o.currentVersionId) : null;
        const checks = await ctx.db
          .query("sourceChecks")
          .withIndex("by_offer", (q) => q.eq("offerId", o._id))
          .take(20);
        return { ...o, supplier, sourceChecks: checks, rawBody: version?.rawBody };
      }),
    );
    return enriched;
  },
});

export const listOfferVersions = query({
  args: { needId: v.id("needs") },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    await requireNeedOwner(ctx, args.needId);
    return await ctx.db
      .query("offerVersions")
      .withIndex("by_need", (q) => q.eq("needId", args.needId))
      .order("desc")
      .take(200);
  },
});

export const listAllOffers = internalQuery({
  args: { limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db.query("offers").order("desc").take(Math.min(args.limit ?? 100, 500));
  },
});

export const getOfferForClarification = internalQuery({
  args: { offerId: v.id("offers") },
  returns: v.any(),
  handler: async (ctx, args) => await ctx.db.get(args.offerId),
});

export const getOfferForVerification = query({
  args: { offerId: v.id("offers") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const access = await requireOfferOwner(ctx, args.offerId);
    return { ...access.offer, need: access.need, ownerId: access.ownerId };
  },
});
