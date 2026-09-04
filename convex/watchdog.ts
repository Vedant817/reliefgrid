import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { writeAudit } from "./lib/audit";

// Deadline watchdog, run hourly by cron. Finds needs due within two hours
// that still have no feasible cover, writes a tamper-evident escalation
// audit per need, then schedules one digest email (never one per need, so a
// busy hour cannot spam the inbox).
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
    for (const need of atRisk) {
      await writeAudit(ctx, {
        entity: "needs",
        entityId: need._id,
        action: "deadline_escalation",
        actor: "watchdog",
        incidentId: need.incidentId,
        meta: JSON.stringify({ item: need.item, qty: need.qty, deadlineAt: need.deadlineAt }),
      });
    }
    if (atRisk.length > 0) {
      await ctx.scheduler.runAfter(0, internal.actions.notify.sendDeadlineDigest, {
        items: atRisk.map((need) => ({
          needId: need._id,
          item: need.item,
          qty: need.qty,
          deadlineAt: need.deadlineAt,
        })),
      });
    }
    return { atRisk: atRisk.length };
  },
});
