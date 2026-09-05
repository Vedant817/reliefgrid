"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { api, components } from "./_generated/api";
import { Agent, createTool, type ToolCtx } from "@convex-dev/agent";
import { createGroq } from "@ai-sdk/groq";
import { stepCountIs } from "ai";
import { z } from "zod";

declare const process: { env: Record<string, string | undefined> };

function groqModel() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("no Groq key configured (GROQ_API_KEY)");
  return createGroq({ apiKey })(process.env.GROQ_MODEL ?? "openai/gpt-oss-120b");
}

// Coordinator assistant: answers status questions with live tools instead of
// guessing. Tools are read-only; clarification drafting stays human-approved
// in the UI and never auto-sends.
export const reliefAgent = new Agent(components.agent, {
  name: "ReliefGrid Coordinator",
  languageModel: groqModel(),
  stopWhen: stepCountIs(5),
  instructions:
    "You are the ReliefGrid relief coordinator assistant. Answer questions about incidents, needs, offers, " +
    "allocation plans, verification, and audit history using your tools — never invent quantities, prices, or " +
    "supplier names. When an offer looks ambiguous, say so and offer to draft a targeted clarification. " +
    "Keep answers short and cite coverage numbers.",
  tools: {
    needStatus: createTool({
      description: "Current plan coverage, cost, and status for a need.",
      inputSchema: z.object({ needId: z.string() }),
      execute: async (ctx: ToolCtx, args: { needId: string }) => {
        const need: any = await ctx.runQuery(api.needs.getNeed, { needId: args.needId as any });
        const plan: any = await ctx.runQuery(api.allocations.getLatestPlan, { needId: args.needId as any });
        if (!need) return { error: "need not found" };
        return {
          item: need.item,
          target: need.qty,
          status: need.status,
          plan: plan ? { coverage: plan.totalQty, costCents: plan.totalCostCents, status: plan.status } : null,
        };
      },
    }),
    searchNeeds: createTool({
      description: "Search needs by item text.",
      inputSchema: z.object({ query: z.string() }),
      execute: async (ctx: ToolCtx, args: { query: string }) => {
        const rows: any[] = await ctx.runQuery(api.search.searchNeeds, { query: args.query, limit: 10 });
        return rows.map((r) => ({ id: r._id, item: r.item, qty: r.qty, status: r.status }));
      },
    }),
    whatIf: createTool({
      description: "Side-effect-free counterfactual: what changes if the deadline is relaxed.",
      inputSchema: z.object({ needId: z.string(), hours: z.number() }),
      execute: async (ctx: ToolCtx, args: { needId: string; hours: number }) => {
        const result: any = await ctx.runQuery(api.counterfactual.compareConstraints, {
          needId: args.needId as any,
          deadlineExtensionHours: args.hours,
        });
        return {
          baseline: { qty: result.baseline.totalQty, costCents: result.baseline.totalCostCents },
          hypothetical: { qty: result.hypothetical.totalQty, costCents: result.hypothetical.totalCostCents },
          savingsCents: result.savingsCents,
          rejected: result.baseline.rejected.map((r: any) => `${r.supplierName}: ${r.reason}`),
        };
      },
    }),
    recentTimeline: createTool({
      description: "Recent audit events for an incident, newest last.",
      inputSchema: z.object({ incidentId: z.string() }),
      execute: async (ctx: ToolCtx, args: { incidentId: string }) => {
        const events: any[] = await ctx.runQuery(api.replay.listTimeline, { incidentId: args.incidentId as any });
        return events.slice(-10).map((e) => ({ action: e.action, actor: e.actor, at: e.at }));
      },
    }),
  },
});

export const askCoordinator = action({
  args: {
    userId: v.string(),
    threadId: v.optional(v.string()),
    prompt: v.string(),
  },
  returns: v.object({ threadId: v.string(), text: v.string() }),
  handler: async (ctx, args) => {
    const { threadId } = args.threadId
      ? { threadId: args.threadId }
      : await reliefAgent.createThread(ctx, { userId: args.userId, title: args.prompt.slice(0, 60) });
    const result = await reliefAgent.generateText(
      ctx,
      { threadId, userId: args.userId },
      { prompt: args.prompt },
    );
    return { threadId, text: result.text };
  },
});
