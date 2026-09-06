import { internal } from "../_generated/api";
import { checkLimit } from "../rateLimits";

export const IDEMPOTENCY_WINDOW_MS = 23 * 60 * 60 * 1000;

export type SendClaim = {
  reconcile?: boolean;
  claimedAt?: number;
};

// Executes the shared provider-send pipeline behind every AgentMail send:
// stale-claim rejection, rate limit (releasing the claim on failure),
// provider send (releasing the claim and recording a failed run on
// failure), finish step, live run. Callers keep their claim acquisition,
// dedupe policy, payload, and return shaping; awards stay out because its
// batching plus per-row reconcile and recovery scheduling is a different
// interface, and inbox creation stays out because its shared-vs-create
// branches rate-limit differently.
export async function guardedProviderSend<Sent extends { threadId: string; latencyMs: number }>(
  ctx: any,
  opts: {
    ownerId: string;
    rateLimit: { name: Parameters<typeof checkLimit>[1]; key: string } | null;
    operation: string;
    failureRequestId: string;
    liveRun: (sent: Sent) => { requestId?: string; meta?: string };
    claim: SendClaim | null;
    releaseClaim?: (claim: SendClaim) => Promise<unknown>;
    staleAfterMs?: number;
    staleMessage?: string;
    send: (claim: SendClaim | null) => Promise<Sent>;
    finish?: (claim: SendClaim | null, sent: Sent) => Promise<unknown>;
  },
): Promise<{ claim: SendClaim | null; sent: Sent }> {
  const { claim } = opts;
  if (
    claim?.reconcile &&
    opts.staleAfterMs !== undefined &&
    Date.now() - (claim.claimedAt ?? 0) >= opts.staleAfterMs
  ) {
    throw new Error(opts.staleMessage ?? "Send is older than the provider idempotency window and requires manual review");
  }
  if (opts.rateLimit) {
    try {
      await checkLimit(ctx, opts.rateLimit.name, opts.rateLimit.key, opts.ownerId);
    } catch (error) {
      if (claim && opts.releaseClaim) await opts.releaseClaim(claim);
      throw error;
    }
  }
  const startedAt = Date.now();
  let sent: Sent;
  try {
    sent = await opts.send(claim);
  } catch (error) {
    if (claim && opts.releaseClaim) await opts.releaseClaim(claim);
    await ctx.runMutation(internal.health.recordProviderRun, {
      provider: "agentmail",
      operation: opts.operation,
      status: "failed",
      latencyMs: Date.now() - startedAt,
      requestId: opts.failureRequestId,
      meta: JSON.stringify({ error: error instanceof Error ? error.message : "unknown" }),
      ownerId: opts.ownerId,
    });
    throw error;
  }
  if (opts.finish) await opts.finish(claim, sent);
  const live = opts.liveRun(sent);
  await ctx.runMutation(internal.health.recordProviderRun, {
    provider: "agentmail",
    operation: opts.operation,
    status: "live",
    latencyMs: sent.latencyMs,
    requestId: live.requestId,
    meta: live.meta,
    ownerId: opts.ownerId,
  });
  return { claim, sent };
}
