import { MutationCtx } from "../_generated/server";

export async function writeAudit(
  ctx: MutationCtx,
  args: {
    entity: string;
    entityId: string;
    action: string;
    actor: string;
    meta?: string;
  },
) {
  await ctx.db.insert("auditEvents", {
    entity: args.entity,
    entityId: args.entityId,
    action: args.action,
    actor: args.actor,
    at: Date.now(),
    meta: args.meta,
  });
}
