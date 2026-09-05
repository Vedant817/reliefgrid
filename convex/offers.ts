import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { offersByNeed } from "./offerTotals";

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
    if (args.qty < 0) throw new Error("qty must be >= 0");
    if (args.unitPriceCents < 0) throw new Error("unitPriceCents must be >= 0");
    if (!args.rawEmailId.trim()) throw new Error("rawEmailId must not be empty");
    const need = await ctx.db.get(args.needId);
    if (!need) throw new Error("Need not found");

    // Replay guard: same email seen before must carry identical terms.
    const priorVersions = await ctx.db
      .query("offerVersions")
      .withIndex("by_need", (q) => q.eq("needId", args.needId))
      .collect();
    const sameEmail = priorVersions.find(
      (ver) => ver.supplierId === args.supplierId && ver.rawEmailId === args.rawEmailId,
    );
    if (sameEmail) {
      const identical =
        sameEmail.qty === args.qty &&
        sameEmail.unitPriceCents === args.unitPriceCents &&
        sameEmail.arrivalAt === args.arrivalAt &&
        sameEmail.certStatus === args.certStatus;
      if (!identical) throw new Error("duplicate email with divergent terms rejected");
      const existingOffer = await ctx.db
        .query("offers")
        .withIndex("by_need", (q) => q.eq("needId", args.needId))
        .collect()
        .then((offers) => offers.find((o) => o.supplierId === args.supplierId));
      if (existingOffer) return existingOffer._id;
    }

    const existingOffer = await ctx.db
      .query("offers")
      .withIndex("by_need", (q) => q.eq("needId", args.needId))
      .collect()
      .then((offers) => offers.find((o) => o.supplierId === args.supplierId));

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
        certStatus: args.certStatus,
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
        certStatus: args.certStatus,
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

export const listAllOfferVersions = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    return await ctx.db.query("offerVersions").order("desc").take(200);
  },
});

export const storeOfferEmbedding = mutation({
  args: { versionId: v.id("offerVersions"), embedding: v.array(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.embedding.length !== 768) throw new Error("embedding must be 768 dimensions");
    await ctx.db.patch(args.versionId, { embedding: args.embedding });
    return null;
  },
});

export const listAllOffers = query({
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
