import { internal } from "../_generated/api";

export type RunProvider = "convex" | "openai" | "groq" | "firecrawl" | "agentmail";

// One call records one provider-ledger row for an attempt whose outcome is
// already known. Callers keep policy (what counts as failed, which ids);
// this owns only the row shape. Pass through provider-measured latency when
// the provider reports its own; otherwise wall-clock from startedAt.
export async function recordRun(
  ctx: any,
  args: {
    provider: RunProvider;
    operation: string;
    status: "live" | "failed";
    startedAt?: number;
    latencyMs?: number;
    requestId?: string;
    meta?: string;
    ownerId?: string;
  },
) {
  return await ctx.runMutation(internal.health.recordProviderRun, {
    provider: args.provider,
    operation: args.operation,
    status: args.status,
    latencyMs: args.latencyMs ?? (args.startedAt !== undefined ? Date.now() - args.startedAt : undefined),
    requestId: args.requestId,
    meta: args.meta,
    ownerId: args.ownerId,
  });
}
