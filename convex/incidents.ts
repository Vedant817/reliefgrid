import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { requireIncidentOwner, requireOwnerId } from "./model/auth";

export const createIncident = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    deadlineAt: v.number(),
  },
  returns: v.id("incidents"),
  handler: async (ctx, args) => {
    const ownerId = await requireOwnerId(ctx);
    const now = Date.now();
    if (!args.title.trim()) throw new Error("title must not be empty");
    if (args.title.length > 120) throw new Error("title must be at most 120 characters");
    if ((args.description?.length ?? 0) > 2000) throw new Error("description must be at most 2000 characters");
    if (args.deadlineAt <= now) throw new Error("deadlineAt must be in the future");
    const id = await ctx.db.insert("incidents", {
      title: args.title,
      description: args.description,
      deadlineAt: args.deadlineAt,
      orgId: ownerId,
      ownerId,
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
  returns: v.array(v.any()),
  handler: async (ctx) => {
    const ownerId = await requireOwnerId(ctx);
    return await ctx.db.query("incidents").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).order("desc").take(100);
  },
});

export const getIncident = query({
  args: { incidentId: v.id("incidents") },
  returns: v.any(),
  handler: async (ctx, args) => {
    return (await requireIncidentOwner(ctx, args.incidentId)).incident;
  },
});
