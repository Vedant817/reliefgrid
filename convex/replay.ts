import { v } from "convex/values";
import { query } from "./_generated/server";

export const listTimeline = query({
  args: { incidentId: v.id("incidents") },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("auditEvents")
      .withIndex("by_incident_at", (q) => q.eq("incidentId", args.incidentId))
      .order("asc")
      .take(100);
  },
});

export const getIncidentAt = query({
  args: { eventId: v.id("auditEvents") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event) throw new Error("Audit event not found");
    if (!event.snapshot) throw new Error("This legacy event has no replay snapshot");
    return {
      event,
      snapshot: JSON.parse(event.snapshot),
      normalizedSnapshot: event.snapshot,
    };
  },
});
