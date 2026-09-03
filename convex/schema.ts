import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  incidents: defineTable({
    title: v.string(),
    orgId: v.optional(v.string()),
    status: v.string(), // draft, researching, awaiting_responses, planning, awaiting_approval, awarded, partially_fulfilled, fulfilled
    deadlineAt: v.number(), // ms
    createdAt: v.number(),
    updatedAt: v.number(),
    description: v.optional(v.string()),
  })
    .index("by_status", ["status"])
    .index("by_deadline", ["deadlineAt"]),

  needs: defineTable({
    incidentId: v.id("incidents"),
    item: v.string(),
    qty: v.number(),
    deadlineAt: v.number(),
    budgetCents: v.number(),
    certRequired: v.optional(v.string()), // e.g. "NSF/ANSI 53"
    partialAllowed: v.boolean(),
    status: v.string(),
    createdAt: v.number(),
  })
    .index("by_incident", ["incidentId"])
    .index("by_status", ["status"]),

  suppliers: defineTable({
    name: v.string(),
    contactEmail: v.string(),
    region: v.string(),
    verified: v.boolean(),
    createdAt: v.number(),
  }),

  rfqThreads: defineTable({
    needId: v.id("needs"),
    supplierId: v.id("suppliers"),
    inboxId: v.optional(v.string()),
    threadId: v.optional(v.string()),
    status: v.string(), // pending, sent, replied, awarded, rejected
    sentAt: v.optional(v.number()),
    lastReplyAt: v.optional(v.number()),
  }).index("by_need", ["needId"]),

  offers: defineTable({
    needId: v.id("needs"),
    supplierId: v.id("suppliers"),
    qty: v.number(),
    unitPriceCents: v.number(),
    arrivalAt: v.number(),
    certStatus: v.string(), // verified, unverified, needs_review
    conditions: v.array(v.string()),
    confidence: v.number(),
    rawEmailId: v.optional(v.string()),
    language: v.optional(v.string()),
    status: v.string(), // active, superseded
    updatedAt: v.number(),
  }).index("by_need", ["needId"]),

  offerVersions: defineTable({
    offerId: v.optional(v.id("offers")),
    needId: v.id("needs"),
    supplierId: v.id("suppliers"),
    qty: v.number(),
    unitPriceCents: v.number(),
    arrivalAt: v.number(),
    certStatus: v.string(),
    conditions: v.array(v.string()),
    confidence: v.number(),
    rawEmailId: v.string(),
    rawBody: v.string(),
    language: v.string(),
    createdAt: v.number(),
  })
    .index("by_offer", ["offerId"])
    .index("by_need", ["needId"]),

  sourceChecks: defineTable({
    offerId: v.id("offers"),
    url: v.string(),
    quote: v.string(),
    retrievedAt: v.number(),
    status: v.string(), // verified, unverified, needs_review, failed
    reason: v.string(),
    type: v.string(), // cert, recall, spec
  }).index("by_offer", ["offerId"]),

  allocationPlans: defineTable({
    needId: v.id("needs"),
    status: v.string(), // proposed, approved, rejected, superseded
    totalCostCents: v.number(),
    totalQty: v.number(),
    createdAt: v.number(),
    decisionTrace: v.optional(v.string()),
  }).index("by_need", ["needId"]),

  allocationLines: defineTable({
    planId: v.id("allocationPlans"),
    supplierId: v.id("suppliers"),
    offerId: v.id("offers"),
    qty: v.number(),
    costCents: v.number(),
    reason: v.string(),
  }).index("by_plan", ["planId"]),

  approvals: defineTable({
    planId: v.id("allocationPlans"),
    approvedBy: v.string(),
    approvedAt: v.number(),
    notes: v.optional(v.string()),
  }).index("by_plan", ["planId"]),

  deliveries: defineTable({
    needId: v.id("needs"),
    receivedQty: v.number(),
    status: v.string(),
    recordedAt: v.number(),
  }).index("by_need", ["needId"]),

  auditEvents: defineTable({
    entity: v.string(),
    entityId: v.string(),
    action: v.string(),
    actor: v.string(),
    at: v.number(),
    meta: v.optional(v.string()),
  })
    .index("by_entity", ["entity", "entityId"])
    .index("by_at", ["at"]),

  // Helper for inbox simulation / agentmail mapping
  inboxes: defineTable({
    needId: v.id("needs"),
    inboxId: v.string(),
    email: v.string(),
    createdAt: v.number(),
  }).index("by_need", ["needId"]),

  // Provider execution ledger — safe proof only, never secrets or message bodies
  providerRuns: defineTable({
    provider: v.union(
      v.literal("convex"),
      v.literal("openai"),
      v.literal("firecrawl"),
      v.literal("agentmail"),
    ),
    operation: v.string(), // e.g. extract, scrape, send_rfq, webhook
    status: v.union(
      v.literal("live"),
      v.literal("mock"),
      v.literal("degraded"),
      v.literal("not_configured"),
      v.literal("failed"),
    ),
    latencyMs: v.optional(v.number()),
    requestId: v.optional(v.string()),
    at: v.number(),
    meta: v.optional(v.string()),
  })
    .index("by_provider", ["provider"])
    .index("by_at", ["at"]),

  // Controlled demo bulletin for Evidence Drift (11.2) — public, synthetic
  demoBulletins: defineTable({
    key: v.string(),
    title: v.string(),
    state: v.union(v.literal("CLEAR"), v.literal("RECALL_ACTIVE")),
    body: v.string(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
});
