import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Supplier evidence attachments (cert PDFs, spec photos). Files live in
// Convex storage; tables reference storage IDs and the read path mints
// short-lived URLs on demand — raw external URLs are never stored.
export const generateUploadUrl = mutation({
  args: { offerId: v.id("offers") },
  returns: v.string(),
  handler: async (ctx, args) => {
    const offer = await ctx.db.get(args.offerId);
    if (!offer) throw new Error("Offer not found");
    return await ctx.storage.generateUploadUrl();
  },
});

export const recordAttachment = mutation({
  args: {
    offerId: v.id("offers"),
    storageId: v.id("_storage"),
    name: v.string(),
    contentType: v.optional(v.string()),
    size: v.optional(v.number()),
  },
  returns: v.id("evidenceAttachments"),
  handler: async (ctx, args) => {
    const offer = await ctx.db.get(args.offerId);
    if (!offer) throw new Error("Offer not found");
    if (!args.name.trim()) throw new Error("name must not be empty");
    if (args.size !== undefined && args.size > 10 * 1024 * 1024) {
      throw new Error("attachment over 10MB rejected");
    }
    return await ctx.db.insert("evidenceAttachments", { ...args, uploadedAt: Date.now() });
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
    const rows = await ctx.db
      .query("evidenceAttachments")
      .withIndex("by_offer", (q) => q.eq("offerId", args.offerId))
      .collect();
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
    await ctx.storage.delete(row.storageId);
    await ctx.db.delete(args.attachmentId);
    return null;
  },
});
