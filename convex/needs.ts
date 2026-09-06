import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { requireIncidentOwner, requireNeedOwner } from "./model/auth";

export const createNeed = mutation({
  args: {
    incidentId: v.id("incidents"),
    item: v.string(),
    qty: v.number(),
    deadlineAt: v.number(),
    budgetCents: v.number(),
    certRequired: v.optional(v.string()),
    evidenceKey: v.optional(v.string()),
    partialAllowed: v.boolean(),
    unit: v.optional(v.string()),
    deliveryLocation: v.optional(v.string()),
    timezone: v.optional(v.string()),
    currency: v.optional(v.string()),
  },
  returns: v.id("needs"),
  handler: async (ctx, args) => {
    await requireIncidentOwner(ctx, args.incidentId);
    const currentNeeds = await ctx.db.query("needs").withIndex("by_incident", (q) => q.eq("incidentId", args.incidentId)).take(100);
    if (currentNeeds.length >= 100) throw new Error("An incident can have at most 100 needs");
    if (!args.item.trim()) throw new Error("item must not be empty");
    if (args.item.length > 200) throw new Error("item must be at most 200 characters");
    if ((args.certRequired?.length ?? 0) > 120) throw new Error("certRequired must be at most 120 characters");
    if ((args.evidenceKey?.length ?? 0) > 120) throw new Error("evidenceKey must be at most 120 characters");
    if ((args.deliveryLocation?.length ?? 0) > 300) throw new Error("deliveryLocation must be at most 300 characters");
    if ((args.timezone?.length ?? 0) > 100) throw new Error("timezone must be at most 100 characters");
    if (!Number.isInteger(args.qty) || args.qty < 1) throw new Error("qty must be an integer >= 1");
    if (args.budgetCents < 0) throw new Error("budgetCents must be >= 0");
    if (args.deadlineAt <= Date.now()) throw new Error("deadlineAt must be in the future");
    const id = await ctx.db.insert("needs", {
      incidentId: args.incidentId,
      item: args.item,
      qty: args.qty,
      deadlineAt: args.deadlineAt,
      budgetCents: args.budgetCents,
      certRequired: args.certRequired,
      evidenceKey: args.evidenceKey,
      partialAllowed: args.partialAllowed,
      unit: args.unit,
      deliveryLocation: args.deliveryLocation,
      timezone: args.timezone,
      currency: args.currency ?? "USD",
      status: "draft",
      createdAt: Date.now(),
    });
    await writeAudit(ctx, {
      entity: "needs",
      entityId: id,
      action: "create",
      actor: "coordinator",
      incidentId: args.incidentId,
      meta: JSON.stringify({ item: args.item, qty: args.qty }),
    });
    return id;
  },
});

export const listNeedsByIncident = query({
  args: { incidentId: v.id("incidents") },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    await requireIncidentOwner(ctx, args.incidentId);
    const needs = await ctx.db
      .query("needs")
      .withIndex("by_incident", (q) => q.eq("incidentId", args.incidentId))
      .take(100);
    return needs;
  },
});

export const getNeed = query({
  args: { needId: v.id("needs") },
  returns: v.any(),
  handler: async (ctx, args) => {
    return (await requireNeedOwner(ctx, args.needId)).need;
  },
});

export const getDemoNeed = query({
  args: { needId: v.id("needs") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { need, incident, ownerId } = await requireNeedOwner(ctx, args.needId);
    if (!incident.isDemo) throw new Error("This operation is available only for the controlled demo");
    return { ...need, ownerId };
  },
});

// Owner-checked need plus identity for need-scoped actions (public recall
// checks, supplier discovery). Works for demo and customer needs alike.
export const getNeedOwnership = internalQuery({
  args: { needId: v.id("needs") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { need, incident, ownerId } = await requireNeedOwner(ctx, args.needId);
    return { need, incident, ownerId };
  },
});
