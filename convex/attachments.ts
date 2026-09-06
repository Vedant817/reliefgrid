import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOfferOwner } from "./model/auth";

// Supplier evidence attachments (cert PDFs, spec photos). Files live in
// Convex storage; tables reference storage IDs and the read path mints
// short-lived URLs on demand — raw external URLs are never stored.
export const generateUploadUrl = mutation({
  args: { offerId: v.id("offers") },
  returns: v.string(),
  handler: async (ctx, args) => {
    await requireOfferOwner(ctx, args.offerId);
    return await ctx.storage.generateUploadUrl();
  },
});

export const recordAttachment = mutation({
  args: {
    offerId: v.id("offers"),
    storageId: v.id("_storage"),
    name: v.string(),
  },
  returns: v.id("evidenceAttachments"),
  handler: async (ctx, args) => {
    await requireOfferOwner(ctx, args.offerId);
    if (!args.name.trim()) throw new Error("name must not be empty");
    if (args.name.length > 200) throw new Error("name must be at most 200 characters");
    const metadata = await ctx.db.system.get(args.storageId);
    if (!metadata) throw new Error("Uploaded file not found");
    if (metadata.size > 10 * 1024 * 1024) {
      throw new Error("attachment over 10MB rejected");
    }
    const allowedTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "text/plain"]);
    if (!metadata.contentType || !allowedTypes.has(metadata.contentType)) throw new Error("attachment type is not allowed");
    const existing = await ctx.db.query("evidenceAttachments").withIndex("by_offer", (q) => q.eq("offerId", args.offerId)).take(20);
    if (existing.length >= 20) throw new Error("an offer can have at most 20 attachments");
    return await ctx.db.insert("evidenceAttachments", {
      ...args,
      contentType: metadata.contentType,
      size: metadata.size,
      uploadedAt: Date.now(),
    });
  },
});

export const listAttachmentsByOffer = query({
  args: { offerId: v.id("offers") },
  returns: v.array(
    v.object({
      _id: v.id("evidenceAttachments"),
      name: v.string(),
      url: v.union(v.string(), v.null()),
      uploadedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireOfferOwner(ctx, args.offerId);
    const rows = await ctx.db
      .query("evidenceAttachments")
      .withIndex("by_offer", (q) => q.eq("offerId", args.offerId))
      .take(20);
    return await Promise.all(
      rows.map(async (row) => ({
        _id: row._id,
        name: row.name,
        url: await ctx.storage.getUrl(row.storageId),
        uploadedAt: row.uploadedAt,
      })),
    );
  },
});

export const removeAttachment = mutation({
  args: { attachmentId: v.id("evidenceAttachments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.attachmentId);
    if (!row) throw new Error("Attachment not found");
    await requireOfferOwner(ctx, row.offerId);
    await ctx.storage.delete(row.storageId);
    await ctx.db.delete(args.attachmentId);
    return null;
  },
});
