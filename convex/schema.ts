import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const evidenceSpan = v.object({
  confidence: v.number(),
  start: v.number(),
  end: v.number(),
  quote: v.string(),
});

const fieldEvidence = v.object({
  qty: evidenceSpan,
  price: evidenceSpan,
  arrival: evidenceSpan,
  cert: evidenceSpan,
});

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
    .index("by_deadline", ["deadlineAt"])
    .index("by_title", ["title"])
    .searchIndex("search_title", { searchField: "title" }),

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
    .index("by_status", ["status"])
    .searchIndex("search_item", { searchField: "item", filterFields: ["incidentId", "status"] }),

  suppliers: defineTable({
    name: v.string(),
    contactEmail: v.string(),
    region: v.string(),
    verified: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_email", ["contactEmail"])
    .searchIndex("search_name", { searchField: "name" }),

  // Supplier evidence attachments (cert PDFs, spec photos). Files live in
  // Convex storage; tables store only the storage ID, never external URLs.
  evidenceAttachments: defineTable({
    offerId: v.id("offers"),
    storageId: v.id("_storage"),
    name: v.string(),
    contentType: v.optional(v.string()),
    size: v.optional(v.number()),
    uploadedAt: v.number(),
  }).index("by_offer", ["offerId"]),

  rfqThreads: defineTable({
    needId: v.id("needs"),
    supplierId: v.id("suppliers"),
    inboxId: v.optional(v.string()),
    threadId: v.optional(v.string()),
    status: v.string(), // pending, sent, replied, awarded, rejected
    sentAt: v.optional(v.number()),
    lastReplyAt: v.optional(v.number()),
    agentmailThreadId: v.optional(v.string()),
    agentmailMessageId: v.optional(v.string()),
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
    fieldEvidence: v.optional(fieldEvidence),
    currentVersionId: v.optional(v.id("offerVersions")),
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
    fieldEvidence: v.optional(fieldEvidence),
    previousVersionId: v.optional(v.id("offerVersions")),
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
    inputHash: v.optional(v.string()),
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
    incidentId: v.optional(v.id("incidents")),
    eventVersion: v.optional(v.number()),
    previousEventId: v.optional(v.id("auditEvents")),
    snapshot: v.optional(v.string()),
  })
    .index("by_entity", ["entity", "entityId"])
    .index("by_at", ["at"])
    .index("by_incident_at", ["incidentId", "at"]),

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
      v.literal("groq"),
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

  holdNotices: defineTable({
    needId: v.id("needs"),
    offerId: v.id("offers"),
    status: v.union(v.literal("draft"), v.literal("approved"), v.literal("sent"), v.literal("sent_fixture")),
    subject: v.string(),
    body: v.string(),
    citationUrl: v.string(),
    createdAt: v.number(),
    approvedAt: v.optional(v.number()),
    approvedBy: v.optional(v.string()),
  }).index("by_need", ["needId"]),
});
