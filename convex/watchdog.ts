import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { writeAudit } from "./lib/audit";

// Deadline watchdog, run hourly by cron. Finds needs due within two hours
// that still have no feasible cover and writes a tamper-evident escalation
// audit per need. Tenant data is never emailed anywhere: escalation ends at
// the audit trail, which the workspace surfaces.
export const checkDeadlines = internalMutation({
  args: {},
  returns: v.object({ atRisk: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();
    const horizon = now + 2 * 60 * 60 * 1000;
    const candidates = await ctx.db
      .query("needs")
      .withIndex("by_status", (q) => q.eq("status", "planning"))
      .take(100);
    const awaiting = await ctx.db
      .query("needs")
      .withIndex("by_status", (q) => q.eq("status", "awaiting_responses"))
      .take(100);
    const atRisk = [...candidates, ...awaiting].filter((need) => need.deadlineAt < horizon);
    // Dedup on the need row itself, not an audit scan: a stuck need
    // escalates at most once per half-day however many hourly ticks fire.
    const since = now - 12 * 60 * 60 * 1000;
    const fresh = atRisk.filter((need) => (need.lastEscalatedAt ?? 0) <= since);
    for (const need of fresh) {
      await ctx.db.patch(need._id, { lastEscalatedAt: now });
      await writeAudit(ctx, {
        entity: "needs",
        entityId: need._id,
        action: "deadline_escalation",
        actor: "watchdog",
        incidentId: need.incidentId,
        meta: JSON.stringify({ item: need.item, qty: need.qty, deadlineAt: need.deadlineAt }),
      });
    }
    return { atRisk: fresh.length };
  },
});
