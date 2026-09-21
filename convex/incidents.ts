import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { requireIncidentOwner, requireOwnerKeys } from "./model/auth";

export const createIncident = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    deadlineAt: v.number(),
  },
  returns: v.id("incidents"),
  handler: async (ctx, args) => {
    const { ownerId } = await requireOwnerKeys(ctx);
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

export const createRequirement = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    deadlineAt: v.number(),
    certification: v.optional(v.string()),
    evidenceKey: v.optional(v.string()),
    deliveryLocation: v.string(),
    timezone: v.string(),
    items: v.array(v.object({
      item: v.string(),
      qty: v.number(),
      budgetCents: v.number(),
    })),
  },
  returns: v.object({
    incidentId: v.id("incidents"),
    needIds: v.array(v.id("needs")),
  }),
  handler: async (ctx, args) => {
    const { ownerId } = await requireOwnerKeys(ctx);
    const now = Date.now();
    const title = args.title.trim();
    if (!title) throw new Error("title must not be empty");
    if (title.length > 120) throw new Error("title must be at most 120 characters");
    if ((args.description?.length ?? 0) > 2000) throw new Error("description must be at most 2000 characters");
    if (args.deadlineAt <= now) throw new Error("deadlineAt must be in the future");
    if (args.items.length < 1 || args.items.length > 10) throw new Error("A requirement must have between 1 and 10 line items");
    if (!args.deliveryLocation.trim() || args.deliveryLocation.length > 300) throw new Error("Enter a delivery location of at most 300 characters");
    if (args.timezone.length > 100) throw new Error("timezone must be at most 100 characters");
    if ((args.certification?.length ?? 0) > 120) throw new Error("certification must be at most 120 characters");
    if ((args.evidenceKey?.length ?? 0) > 120) throw new Error("evidenceKey must be at most 120 characters");
    for (const item of args.items) {
      if (!item.item.trim() || item.item.length > 200) throw new Error("Each item must have a name of at most 200 characters");
      if (!Number.isInteger(item.qty) || item.qty < 1) throw new Error("Each quantity must be an integer of at least 1");
      if (!Number.isInteger(item.budgetCents) || item.budgetCents < 0) throw new Error("Each budget must be a non-negative cent amount");
    }

    const incidentId = await ctx.db.insert("incidents", {
      title,
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
      entityId: incidentId,
      action: "create",
      actor: "coordinator",
      incidentId,
      meta: JSON.stringify({ title, lineItemCount: args.items.length }),
    });

    const needIds = [];
    for (const item of args.items) {
      const needId = await ctx.db.insert("needs", {
        incidentId,
        item: item.item.trim(),
        qty: item.qty,
        deadlineAt: args.deadlineAt,
        budgetCents: item.budgetCents,
        certRequired: args.certification,
        evidenceKey: args.evidenceKey,
        partialAllowed: true,
        unit: "units",
        deliveryLocation: args.deliveryLocation.trim(),
        timezone: args.timezone,
        currency: "USD",
        status: "draft",
        createdAt: now,
      });
      needIds.push(needId);
      await writeAudit(ctx, {
        entity: "needs",
        entityId: needId,
        action: "create",
        actor: "coordinator",
        incidentId,
        meta: JSON.stringify({ item: item.item.trim(), qty: item.qty }),
      });
    }
    return { incidentId, needIds };
  },
});

export const listIncidents = query({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    const { keys, legacyOwnerPrefix } = await requireOwnerKeys(ctx);
    const seen = new Set<string>();
    const incidents = [];
    for (const key of keys) {
      const rows = await ctx.db.query("incidents").withIndex("by_owner", (q) => q.eq("ownerId", key)).order("desc").take(100);
      for (const row of rows) {
        if (seen.has(String(row._id))) continue;
        seen.add(String(row._id));
        incidents.push(row);
      }
    }
    if (legacyOwnerPrefix) {
      const rows = await ctx.db
        .query("incidents")
        .withIndex("by_owner", (q) => q.gte("ownerId", legacyOwnerPrefix).lt("ownerId", `${legacyOwnerPrefix}\uffff`))
        .order("desc")
        .take(100);
      for (const row of rows) {
        if (seen.has(String(row._id))) continue;
        seen.add(String(row._id));
        incidents.push(row);
      }
    }
    incidents.sort((a, b) => b.createdAt - a.createdAt);
    return incidents.slice(0, 100);
  },
});

export const getIncident = query({
  args: { incidentId: v.id("incidents") },
  returns: v.any(),
  handler: async (ctx, args) => {
    return (await requireIncidentOwner(ctx, args.incidentId)).incident;
  },
});
