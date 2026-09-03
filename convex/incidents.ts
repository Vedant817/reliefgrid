import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";

export const createIncident = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    deadlineAt: v.number(),
    orgId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    if (!args.title.trim()) throw new Error("title must not be empty");
    if (args.deadlineAt <= now) throw new Error("deadlineAt must be in the future");
    const id = await ctx.db.insert("incidents", {
      title: args.title,
      description: args.description,
      deadlineAt: args.deadlineAt,
      orgId: args.orgId,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, {
      entity: "incidents",
      entityId: id,
      action: "create",
      actor: "coordinator",
      incidentId: id,
      meta: JSON.stringify({ title: args.title }),
    });
    return id;
  },
});

export const listIncidents = query({
  args: {},
  handler: async (ctx) => {
    const incidents = await ctx.db.query("incidents").order("desc").collect();
    return incidents;
  },
});

export const getIncident = query({
  args: { incidentId: v.id("incidents") },
  handler: async (ctx, args) => {
    const incident = await ctx.db.get(args.incidentId);
    return incident;
  },
});

export const updateIncidentStatus = mutation({
  args: {
    incidentId: v.id("incidents"),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    const incident = await ctx.db.get(args.incidentId);
    if (!incident) throw new Error("Incident not found");
    await ctx.db.patch(args.incidentId, {
      status: args.status,
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, {
      entity: "incidents",
      entityId: args.incidentId,
      action: `status:${args.status}`,
      actor: "system",
      incidentId: args.incidentId,
    });
    return args.incidentId;
  },
});
