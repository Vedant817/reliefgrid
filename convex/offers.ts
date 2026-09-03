import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";

const evidenceSpan = v.object({ confidence: v.number(), start: v.number(), end: v.number(), quote: v.string() });
const fieldEvidence = v.object({ qty: evidenceSpan, price: evidenceSpan, arrival: evidenceSpan, cert: evidenceSpan });

export const upsertOfferVersion = mutation({
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
    // Create version
    const versionId = await ctx.db.insert("offerVersions", {
      needId: args.needId,
      supplierId: args.supplierId,
      qty: args.qty,
      unitPriceCents: args.unitPriceCents,
      arrivalAt: args.arrivalAt,
      certStatus: args.certStatus,
      conditions: args.conditions,
      confidence: args.confidence,
      fieldEvidence: args.fieldEvidence,
      rawEmailId: args.rawEmailId,
      rawBody: args.rawBody,
      language: args.language,
      createdAt: Date.now(),
    });

    // Upsert current offer
    const existingOffer = await ctx.db
      .query("offers")
      .withIndex("by_need", (q) => q.eq("needId", args.needId))
      .collect()
      .then((offers) => offers.find((o) => o.supplierId === args.supplierId));

    if (existingOffer) {
      await ctx.db.patch(existingOffer._id, {
        qty: args.qty,
        unitPriceCents: args.unitPriceCents,
        arrivalAt: args.arrivalAt,
        certStatus: args.certStatus,
        conditions: args.conditions,
        confidence: args.confidence,
        fieldEvidence: args.fieldEvidence,
        rawEmailId: args.rawEmailId,
        language: args.language,
        updatedAt: Date.now(),
        status: "active",
      });
      // Link version to offer
      await ctx.db.patch(versionId, { offerId: existingOffer._id });

      await writeAudit(ctx, {
        entity: "offers",
        entityId: existingOffer._id,
        action: "update_version",
        actor: "system",
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
        certStatus: args.certStatus,
        conditions: args.conditions,
        confidence: args.confidence,
        fieldEvidence: args.fieldEvidence,
        rawEmailId: args.rawEmailId,
        language: args.language,
        status: "active",
        updatedAt: Date.now(),
      });
      await ctx.db.patch(versionId, { offerId });
      await writeAudit(ctx, {
        entity: "offers",
        entityId: offerId,
        action: "create",
        actor: "system",
        meta: JSON.stringify({ versionId }),
      });
      return offerId;
    }
  },
});

export const listOffersByNeed = query({
  args: { needId: v.id("needs") },
  handler: async (ctx, args) => {
    const offers = await ctx.db
      .query("offers")
      .withIndex("by_need", (q) => q.eq("needId", args.needId))
      .collect();
    const enriched = await Promise.all(
      offers.map(async (o) => {
        const supplier = await ctx.db.get(o.supplierId);
        const checks = await ctx.db
          .query("sourceChecks")
          .withIndex("by_offer", (q) => q.eq("offerId", o._id))
          .collect();
        return { ...o, supplier, sourceChecks: checks };
      }),
    );
    return enriched;
  },
});

export const listOfferVersions = query({
  args: { needId: v.id("needs") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("offerVersions")
      .withIndex("by_need", (q) => q.eq("needId", args.needId))
      .order("desc")
      .collect();
  },
});

export const listAllOffers = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("offers").collect();
  },
});

export const getOfferForClarification = internalQuery({
  args: { offerId: v.id("offers") },
  returns: v.any(),
  handler: async (ctx, args) => await ctx.db.get(args.offerId),
});
