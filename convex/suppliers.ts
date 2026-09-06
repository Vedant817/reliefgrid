import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOwnerId, requireSupplierOwner } from "./model/auth";
import { normalizeMailbox } from "./lib/agentmail";

export const listSuppliers = query({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    const ownerId = await requireOwnerId(ctx);
    return await ctx.db.query("suppliers").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).take(100);
  },
});

export const getSupplier = query({
  args: { supplierId: v.id("suppliers") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { supplier } = await requireSupplierOwner(ctx, args.supplierId);
    return supplier;
  },
});

export const seedSuppliers = mutation({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    const ownerId = await requireOwnerId(ctx);
    const existing = await ctx.db.query("suppliers").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).take(100);
    if (existing.length > 0) return existing;

    const now = Date.now();
    const suppliers = [
      {
        name: "Apex Medical Supply",
        contactEmail: "rfq+apex@synthetic.reliefgrid.test",
        region: "North",
        verified: true,
        createdAt: now,
      },
      {
        name: "BlueRiver Logistics",
        contactEmail: "rfq+blueriver@synthetic.reliefgrid.test",
        region: "Central",
        verified: true,
        createdAt: now,
      },
      {
        name: "Casa Suministros",
        contactEmail: "rfq+casa@synthetic.reliefgrid.test",
        region: "South",
        verified: true,
        createdAt: now,
      },
      {
        name: "Delta Outfitters",
        contactEmail: "rfq+delta@synthetic.reliefgrid.test",
        region: "East",
        verified: false,
        createdAt: now,
      },
      {
        name: "Evergreen Relief Co",
        contactEmail: "rfq+evergreen@synthetic.reliefgrid.test",
        region: "West",
        verified: true,
        createdAt: now,
      },
    ];

    const ids = [];
    for (const s of suppliers) {
      const id = await ctx.db.insert("suppliers", { ...s, ownerId });
      ids.push(id);
    }
    return await ctx.db.query("suppliers").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).take(100);
  },
});

export const upsertSupplier = mutation({
  args: {
    name: v.string(),
    contactEmail: v.string(),
    region: v.string(),
  },
  returns: v.id("suppliers"),
  handler: async (ctx, args) => {
    const ownerId = await requireOwnerId(ctx);
    const contactEmail = normalizeMailbox(args.contactEmail);
    if (!contactEmail) throw new Error("Enter a valid supplier email address");
    const supplier = { ...args, name: args.name.trim(), region: args.region.trim(), contactEmail };
    if (!supplier.name) throw new Error("Supplier name is required");
    if (supplier.name.length > 120) throw new Error("Supplier name must be at most 120 characters");
    if (supplier.contactEmail.length > 320) throw new Error("Supplier email must be at most 320 characters");
    if (!supplier.region || supplier.region.length > 120) throw new Error("Supplier region must be 1-120 characters");
    const existing = await ctx.db
      .query("suppliers")
      .withIndex("by_owner_and_email", (q) => q.eq("ownerId", ownerId).eq("contactEmail", contactEmail))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, supplier);
      return existing._id;
    }
    return await ctx.db.insert("suppliers", { ...supplier, verified: false, ownerId, createdAt: Date.now() });
  },
});
