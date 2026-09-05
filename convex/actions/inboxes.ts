"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api } from "../_generated/api";
import { createAgentMailInbox, resolveAgentMail } from "../lib/agentmail";
import { checkLimit } from "../rateLimits";

// One real AgentMail inbox per need, mapped in the inboxes table.
// Idempotent: an existing mapping is returned without creating a duplicate.
export const ensureInboxForNeed = action({
  args: { needId: v.id("needs") },
  returns: v.object({
    inboxId: v.string(),
    email: v.string(),
    providerStatus: v.literal("live"),
  }),
  handler: async (ctx, args) => {
    const need: any = await ctx.runQuery(api.needs.getNeed, { needId: args.needId });
    if (!need) throw new Error("Need not found");
    const mail = resolveAgentMail();
    if (!mail.apiKey) throw new Error("no AgentMail key configured (AGENTMAIL_API_KEY)");
    const username = `reliefgrid-${String(args.needId).slice(0, 8).toLowerCase()}`;
    const created = await createAgentMailInbox(mail, username, `ReliefGrid ${need.item}`.slice(0, 60));
    const inboxRowId: string = await ctx.runMutation(api.inboxes.ensureInbox, {
      needId: args.needId,
      inboxId: created.inboxId,
      email: created.email,
    });
    void inboxRowId;
    await ctx.runMutation(api.health.recordProviderRun, {
      provider: "agentmail",
      operation: "create_inbox",
      status: "live",
      latencyMs: created.latencyMs,
      requestId: created.inboxId,
      meta: JSON.stringify({ needId: String(args.needId) }),
    });
    return { inboxId: created.inboxId, email: created.email, providerStatus: "live" as const };
  },
});
