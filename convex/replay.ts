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
    // Legacy events without snapshots replay as metadata-only so the UI
    // can never crash on a partial audit trail.
    if (!event.snapshot) {
      return { event, snapshot: null, normalizedSnapshot: null };
    }
    return {
      event,
      snapshot: JSON.parse(event.snapshot),
      normalizedSnapshot: event.snapshot,
    };
  },
});
