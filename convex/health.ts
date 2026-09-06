import { query, internalMutation } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { requireOwnerId } from "./model/auth";

declare const process: { env: Record<string, string | undefined> };

type Provider = "convex" | "openai" | "groq" | "firecrawl" | "agentmail";
type RunStatus = "live" | "mock" | "degraded" | "not_configured" | "failed";

const runStatus = v.union(
  v.literal("live"),
  v.literal("mock"),
  v.literal("degraded"),
  v.literal("not_configured"),
  v.literal("failed"),
);

const provider = v.union(
  v.literal("convex"),
  v.literal("openai"),
  v.literal("groq"),
  v.literal("firecrawl"),
  v.literal("agentmail"),
);

const providerRun = v.object({
  _id: v.id("providerRuns"),
  _creationTime: v.number(),
  provider,
  operation: v.string(),
  status: runStatus,
  latencyMs: v.optional(v.number()),
  requestId: v.optional(v.string()),
  at: v.number(),
  meta: v.optional(v.string()),
  ownerId: v.optional(v.string()),
});

// Backend integration health reports live/mock/degraded/not_configured
// from env presence and recent providerRuns. Never exposes secrets.
export const getProviderHealth = query({
  args: {},
  returns: v.array(v.object({
    provider,
    status: runStatus,
    detail: v.string(),
    lastRun: v.union(providerRun, v.null()),
  })),
  handler: async (ctx) => {
    const ownerId = await requireOwnerId(ctx);
    const env = process.env;
    const hasOpenAI = !!env.OPENAI_API_KEY;
    const hasGroq = !!env.GROQ_API_KEY;
    const hasFirecrawl = !!env.FIRECRAWL_API_KEY;
    const hasAgentMail = !!env.AGENTMAIL_API_KEY;

    const recent = await ctx.db.query("providerRuns").withIndex("by_owner_and_at", (q) => q.eq("ownerId", ownerId)).order("desc").take(20);

    const lastBy = (provider: string) => recent.find((r) => r.provider === provider) ?? null;

    const convexRun = lastBy("convex");
    const openaiRun = lastBy("openai");
    const groqRun = lastBy("groq");
    const firecrawlRun = lastBy("firecrawl");
    const agentmailRun = lastBy("agentmail");

    const statusFor = (last: { status: RunStatus } | null): RunStatus => {
      if (last?.status === "failed") return "degraded";
      if (last) return last.status;
      return "degraded";
    };

    const health: Array<{
      provider: Provider;
      status: RunStatus;
      detail: string;
      lastRun: Doc<"providerRuns"> | null;
    }> = [
      {
        provider: "convex",
        status: "live",
        detail: "reactive backend responding",
        lastRun: convexRun,
      },
      {
        provider: "openai",
        status: hasOpenAI ? statusFor(openaiRun) : "not_configured",
        detail: hasOpenAI ? (openaiRun ? "configured; run evidence below" : "configured; no run verified") : "not configured",
        lastRun: openaiRun,
      },
      {
        provider: "groq",
        status: hasGroq ? statusFor(groqRun) : "not_configured",
        detail: hasGroq ? (groqRun ? "configured; run evidence below" : "configured; no run verified") : "not configured",
        lastRun: groqRun,
      },
      {
        provider: "firecrawl",
        status: hasFirecrawl ? statusFor(firecrawlRun) : "not_configured",
        detail: hasFirecrawl ? (firecrawlRun ? "configured; run evidence below" : "configured; no run verified") : "not configured",
        lastRun: firecrawlRun,
      },
      {
        provider: "agentmail",
        status: hasAgentMail ? statusFor(agentmailRun) : "not_configured",
        detail: hasAgentMail ? (agentmailRun ? "configured; run evidence below" : "configured; no run verified") : "not configured",
        lastRun: agentmailRun,
      },
    ];
    return health;
  },
});

export const recordProviderRun = internalMutation({
  args: {
    provider,
    operation: v.string(),
    status: runStatus,
    latencyMs: v.optional(v.number()),
    requestId: v.optional(v.string()),
    meta: v.optional(v.string()),
    ownerId: v.optional(v.string()),
  },
  returns: v.id("providerRuns"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("providerRuns", { ...args, at: Date.now() });
  },
});

export const listProviderRuns = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(providerRun),
  handler: async (ctx, args) => {
    const ownerId = await requireOwnerId(ctx);
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 20), 100));
    return await ctx.db.query("providerRuns").withIndex("by_owner_and_at", (q) => q.eq("ownerId", ownerId)).order("desc").take(limit);
  },
});

export const listProviderRunsPage = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.any(),
  handler: async (ctx, args) => {
    const ownerId = await requireOwnerId(ctx);
    return await ctx.db.query("providerRuns").withIndex("by_owner_and_at", (q) => q.eq("ownerId", ownerId)).order("desc").paginate(args.paginationOpts);
  },
});
