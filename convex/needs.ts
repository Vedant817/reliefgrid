import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";

export const createNeed = mutation({
  args: {
    incidentId: v.id("incidents"),
    item: v.string(),
    qty: v.number(),
    deadlineAt: v.number(),
    budgetCents: v.number(),
    certRequired: v.optional(v.string()),
    partialAllowed: v.boolean(),
  },
  handler: async (ctx, args) => {
    const incident = await ctx.db.get(args.incidentId);
    if (!incident) throw new Error("Incident not found");
    if (!args.item.trim()) throw new Error("item must not be empty");
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
      partialAllowed: args.partialAllowed,
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
  handler: async (ctx, args) => {
    const needs = await ctx.db
      .query("needs")
      .withIndex("by_incident", (q) => q.eq("incidentId", args.incidentId))
      .collect();
    return needs;
  },
});

export const getNeed = query({
  args: { needId: v.id("needs") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.needId);
  },
});

export const updateNeedStatus = mutation({
  args: {
    needId: v.id("needs"),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    const need = await ctx.db.get(args.needId);
    if (!need) throw new Error("Need not found");
    await ctx.db.patch(args.needId, { status: args.status });
    await writeAudit(ctx, {
      entity: "needs",
      entityId: args.needId,
      action: `status:${args.status}`,
      actor: "system",
      incidentId: need.incidentId,
    });
    return args.needId;
  },
});

export const listAllNeeds = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("needs").collect();
  },
});
