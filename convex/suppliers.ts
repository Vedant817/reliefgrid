import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOwnerKeys, requireSupplierOwner } from "./model/auth";
import { normalizeMailbox } from "./lib/agentmail";

const DEMO_SUPPLIERS = [
  { demoKey: "general-relief", name: "Demo General Relief Wholesale", contactEmail: "quotes@general-relief.example.invalid", region: "Nationwide demo coverage" },
  { demoKey: "shelter-supply", name: "Demo Shelter Supply Co.", contactEmail: "sales@shelter-supply.example.invalid", region: "Regional shelter logistics" },
  { demoKey: "medical-logistics", name: "Demo Medical Logistics", contactEmail: "bids@medical-logistics.example.invalid", region: "Healthcare and emergency response" },
  { demoKey: "water-sanitation", name: "Demo Water & Sanitation Depot", contactEmail: "orders@water-sanitation.example.invalid", region: "Water, hygiene, and sanitation" },
] as const;

async function seedDemoSuppliersForOwner(ctx: MutationCtx, ownerId: string) {
  const existing = await ctx.db.query("suppliers").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).take(100);
  const existingKeys = new Set(existing.map((supplier) => supplier.demoKey).filter(Boolean));
  let inserted = 0;
  for (const supplier of DEMO_SUPPLIERS) {
    if (existingKeys.has(supplier.demoKey)) continue;
    await ctx.db.insert("suppliers", {
      ...supplier,
      ownerId,
      verified: false,
      isDemo: true,
      createdAt: Date.now(),
    });
    inserted++;
  }
  return inserted;
}

export const ensureDemoSuppliers = mutation({
  args: {},
  returns: v.object({ inserted: v.number(), total: v.number() }),
  handler: async (ctx) => {
    const { ownerId } = await requireOwnerKeys(ctx);
    const inserted = await seedDemoSuppliersForOwner(ctx, ownerId);
    return { inserted, total: DEMO_SUPPLIERS.length };
  },
});

// One-time bounded backfill for existing credential accounts. Future accounts
// are covered by ensureDemoSuppliers on authenticated app startup.
export const seedDemoSuppliersForAllAccounts = internalMutation({
  args: {},
  returns: v.object({ accounts: v.number(), inserted: v.number() }),
  handler: async (ctx) => {
    const users = await ctx.db.query("users").order("desc").take(100);
    let accounts = 0;
    let inserted = 0;
    for (const user of users) {
      if (!user.email) continue;
      accounts++;
      inserted += await seedDemoSuppliersForOwner(ctx, String(user._id));
    }
    return { accounts, inserted };
  },
});

export const listSuppliers = query({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    const { keys, legacyOwnerPrefix } = await requireOwnerKeys(ctx);
    const seen = new Set<string>();
    const suppliers = [];
    for (const key of keys) {
      const rows = await ctx.db.query("suppliers").withIndex("by_owner", (q) => q.eq("ownerId", key)).take(100);
      for (const row of rows) {
        if (seen.has(String(row._id))) continue;
        seen.add(String(row._id));
        suppliers.push(row);
      }
    }
    if (legacyOwnerPrefix) {
      const rows = await ctx.db
        .query("suppliers")
        .withIndex("by_owner", (q) => q.gte("ownerId", legacyOwnerPrefix).lt("ownerId", `${legacyOwnerPrefix}\uffff`))
        .take(100);
      for (const row of rows) {
        if (seen.has(String(row._id))) continue;
        seen.add(String(row._id));
        suppliers.push(row);
      }
    }
    return suppliers;
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

export const upsertSupplier = mutation({
  args: {
    name: v.string(),
    contactEmail: v.string(),
    region: v.string(),
  },
  returns: v.id("suppliers"),
  handler: async (ctx, args) => {
    const { ownerId, keys, legacyOwnerPrefix } = await requireOwnerKeys(ctx);
    const contactEmail = normalizeMailbox(args.contactEmail);
    if (!contactEmail) throw new Error("Enter a valid supplier email address");
    if (contactEmail.endsWith(".test") || contactEmail.endsWith(".example") || contactEmail.endsWith(".invalid")) {
      throw new Error("Enter a deliverable supplier email address");
    }
    const supplier = { ...args, name: args.name.trim(), region: args.region.trim(), contactEmail, isDemo: false, demoKey: undefined };
    if (!supplier.name) throw new Error("Supplier name is required");
    if (supplier.name.length > 120) throw new Error("Supplier name must be at most 120 characters");
    if (supplier.contactEmail.length > 320) throw new Error("Supplier email must be at most 320 characters");
    if (!supplier.region || supplier.region.length > 120) throw new Error("Supplier region must be 1-120 characters");
    let existing = null;
    for (const key of keys) {
      existing = await ctx.db
        .query("suppliers")
        .withIndex("by_owner_and_email", (q) => q.eq("ownerId", key).eq("contactEmail", contactEmail))
        .first();
      if (existing) break;
    }
    if (!existing && legacyOwnerPrefix) {
      const legacyRows = await ctx.db
        .query("suppliers")
        .withIndex("by_owner", (q) => q.gte("ownerId", legacyOwnerPrefix).lt("ownerId", `${legacyOwnerPrefix}\uffff`))
        .take(100);
      existing = legacyRows.find((row) => row.contactEmail === contactEmail) ?? null;
    }
    if (existing) {
      await ctx.db.patch(existing._id, { ...supplier, ownerId });
      return existing._id;
    }
    return await ctx.db.insert("suppliers", { ...supplier, verified: false, ownerId, createdAt: Date.now() });
  },
});
