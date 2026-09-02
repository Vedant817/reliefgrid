import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const listSuppliers = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("suppliers").collect();
  },
});

export const getSupplier = query({
  args: { supplierId: v.id("suppliers") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.supplierId);
  },
});

export const seedSuppliers = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("suppliers").collect();
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
      const id = await ctx.db.insert("suppliers", s);
      ids.push(id);
    }
    return await ctx.db.query("suppliers").collect();
  },
});

export const upsertSupplier = mutation({
  args: {
    name: v.string(),
    contactEmail: v.string(),
    region: v.string(),
    verified: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("suppliers")
      .filter((q) => q.eq(q.field("contactEmail"), args.contactEmail))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("suppliers", { ...args, createdAt: Date.now() });
  },
});
