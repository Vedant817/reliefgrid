import { MutationCtx } from "../_generated/server";

export async function writeAudit(
  ctx: MutationCtx,
  args: {
    entity: string;
    entityId: string;
    action: string;
    actor: string;
    meta?: string;
    incidentId?: any;
    snapshot?: string;
  },
) {
  const previous = args.incidentId
    ? await ctx.db.query("auditEvents").withIndex("by_incident_at", (q) => q.eq("incidentId", args.incidentId)).order("desc").first()
    : null;
  return await ctx.db.insert("auditEvents", {
    entity: args.entity,
    entityId: args.entityId,
    action: args.action,
    actor: args.actor,
    at: Date.now(),
    meta: args.meta,
    incidentId: args.incidentId,
    eventVersion: 1,
    previousEventId: previous?._id,
    snapshot: args.snapshot,
  });
}
