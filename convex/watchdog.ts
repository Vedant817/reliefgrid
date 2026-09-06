import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { writeAudit } from "./lib/audit";

// Deadline watchdog, run hourly by cron. Finds needs due within two hours
// that still have no feasible cover, writes a tamper-evident escalation
// audit per need. Tenant data is not sent to a deployment-global mailbox.
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
    // Dedup: skip needs escalated within the last 12h so a stuck need
    // produces one digest per half-day, not one per hour.
    const since = now - 12 * 60 * 60 * 1000;
    const fresh: typeof atRisk = [];
    for (const need of atRisk) {
      const recent = await ctx.db
        .query("auditEvents")
        .withIndex("by_entity", (q) => q.eq("entity", "needs").eq("entityId", need._id))
        .order("desc")
        .take(10);
      if (recent.some((e) => e.action === "deadline_escalation" && e.at > since)) continue;
      fresh.push(need);
    }
    for (const need of fresh) {
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
