"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { createAgentMailInbox, getAgentMailInbox, resolveAgentMail } from "../lib/agentmail";
import { recordRun } from "../lib/runs";
import { checkLimit } from "../rateLimits";

// Each need gets an inbox mapping. Constrained plans reuse one configured
// AgentMail inbox; otherwise a full-access account can create a dedicated one.
export const ensureInboxForNeed = action({
  args: { needId: v.id("needs") },
  returns: v.object({
    inboxId: v.string(),
    email: v.string(),
    providerStatus: v.literal("live"),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");
    const ownership: any = await ctx.runQuery(internal.needs.getNeedOwnership, { needId: args.needId });
    const need = ownership.need;
    const ownerId: string = ownership.ownerId;
    const existing: any = await ctx.runQuery(api.inboxes.getInboxByNeed, { needId: args.needId });
    if (existing) return { inboxId: existing.inboxId, email: existing.email, providerStatus: "live" as const };
    const mail = resolveAgentMail();
    if (!mail.apiKey) throw new Error("no AgentMail key configured (AGENTMAIL_API_KEY)");
    const claim: any = await ctx.runMutation(internal.inboxes.claimInboxCreation, { needId: args.needId });
    if (claim.existing) return { inboxId: claim.existing.inboxId, email: claim.existing.email, providerStatus: "live" as const };
    if (!claim.shouldCreate) throw new Error("Inbox creation is already in progress");
    let created: { inboxId: string; email: string; latencyMs: number };
    let operation: "map_shared_inbox" | "create_inbox";
    if (mail.inboxId) {
      operation = "map_shared_inbox";
      try {
        created = await getAgentMailInbox(mail);
      } catch (error) {
        await ctx.runMutation(internal.inboxes.releaseInboxClaim, { needId: args.needId, claimedAt: claim.claimedAt });
        throw error;
      }
    } else {
      operation = "create_inbox";
      try {
        await checkLimit(ctx, "sendRfq", `inbox:${String(args.needId)}`, ownerId);
      } catch (error) {
        await ctx.runMutation(internal.inboxes.releaseInboxClaim, { needId: args.needId, claimedAt: claim.claimedAt });
        throw error;
      }
      const username = `reliefgrid-${String(args.needId).slice(0, 8).toLowerCase()}`;
      created = await createAgentMailInbox(mail, username, `ReliefGrid ${need.item}`.slice(0, 60));
    }
    const inboxRowId: string = await ctx.runMutation(internal.inboxes.ensureInbox, {
      needId: args.needId,
      inboxId: created.inboxId,
      email: created.email,
    });
    void inboxRowId;
    await recordRun(ctx, {
      provider: "agentmail",
      operation,
      status: "live",
      latencyMs: created.latencyMs,
      requestId: created.inboxId,
      meta: JSON.stringify({ needId: String(args.needId) }),
      ownerId,
    });
    return { inboxId: created.inboxId, email: created.email, providerStatus: "live" as const };
  },
});
