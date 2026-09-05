# Hackathon log

- **Project:** ReliefGrid
- **Event:** Convex All Gas Hackathon
- **What it does:** Coordinates emergency-supply RFQs, verifies supplier offers, and proposes auditable allocations with live evidence-drift recovery.
- **Live app:** not deployed
- **Repo:** none
- **Frontend:** not deployed
- **Convex deployment:** https://judicious-rat-761.convex.cloud
- **Components:** none
- **Convex features:** schema, tables, indexes, queries, mutations, actions, HTTP actions, crons, realtime queries
- **Auth:** none
- **AI models:** none
- **Started:** 2026-09-02T17:02:09Z
- **Last updated:** 2026-09-05T11:34:27Z

## Log

### 2026-09-02 - working tree
Set up project for Convex All Gas Hackathon. Installed Convex Agent Skills (33 skills: convex, convex-auth, convex-crons, etc.) and configured Convex MCP server (npx -y convex@latest mcp start) for Opencode. Added hackathon build-log skill at `.agents/skills/convex-hackathon-skill/` and initialized public build log. Project is empty initialization stage — no application code or Convex backend yet (`.agents/skills/convex-hackathon-skill/SKILL.md`, `.agents/skills/convex-hackathon-skill/references/log-format.md`, `opencode.jsonc`).

### 2026-09-02 - a0bb71f
Built the Vite + React + Tailwind + Convex foundation, defined the 12-table ReliefGrid model with indexes, and added the audit helper plus deterministic allocator library. Convex features: schema, tables, indexes (`convex/schema.ts`, `convex/lib/audit.ts`, `convex/lib/allocate.ts`).

### 2026-09-03 - fd87e34
Shipped the operational backend: incident/need/supplier CRUD, RFQ threads, versioned offers, source-check storage, allocation persistence with approval, audit queries, synthetic seed data, HTTP webhook routes, and crons. Extraction and verification remain explicitly labeled deterministic mocks; no real provider response is claimed. Convex features: queries, mutations, actions, HTTP actions, crons (`convex/incidents.ts`, `convex/needs.ts`, `convex/suppliers.ts`, `convex/rfq.ts`, `convex/offers.ts`, `convex/sourceChecks.ts`, `convex/allocations.ts`, `convex/seed.ts`, `convex/http.ts`, `convex/crons.ts`, `convex/actions/extract.ts`, `convex/actions/verify.ts`).

### 2026-09-03 - 92772f9
Added the four-screen realtime UI (incident board, live offer matrix, allocation inspector, public audit receipt) plus the prioritized wow-feature roadmap, and fixed tsconfig refs, thread ID construction, and the main entry fallback so typecheck and production build pass. Convex features: realtime queries (`src/App.tsx`, `src/components/IncidentBoard.tsx`, `src/components/OfferMatrix.tsx`, `src/components/AllocationInspector.tsx`, `src/components/AuditReceipt.tsx`).

### 2026-09-03 - e383d63
Shipped the verifiable wow layer against the linked dev deployment: truthful provider health ledger with mock-labeled runs, idempotent Reset Demo with a record-derived judge rail, controlled Evidence Drift that invalidates the Apex offer and recomputes a shortfall plan with a human-approved hold-notice draft, field-level extraction evidence with allocator abstention and targeted clarification drafts, side-effect-free counterfactual comparisons with exact rejection reasons, and an append-only decision replay with causal diffs. Provider calls remain labeled mock; no live OpenAI, Firecrawl, or inbox round trip is claimed. Convex features: queries, mutations, actions (`convex/health.ts`, `convex/demo.ts`, `convex/evidenceDrift.ts`, `convex/counterfactual.ts`, `convex/replay.ts`, `convex/actions/clarify.ts`, `src/components/ProviderProof.tsx`, `src/components/DemoRail.tsx`, `src/components/EvidenceDrift.tsx`, `src/components/CounterfactualLab.tsx`, `src/components/DecisionReplay.tsx`).

### 2026-09-03 - e70e6b7
Corrected the plan ledger to mark only proven subtasks, fixed the canonical Casa offer to 30 units, and verified the drift sequence on the dev deployment: reset restores 100/100, recall recomputes 30/100, replacement restores 100/100. Typecheck, allocator tests (4 passed), and production build (116 modules) pass. Correction: prior header claimed Convex static hosting; no hosting config is installed, so Frontend is now `not deployed` (`IMPLEMENTATION_PLAN.md`, `convex/demo.ts`, `convex/evidenceDrift.ts`).

### 2026-09-03 - 8c3a3c3
Closed the remaining unblocked proofs on the dev deployment: the same audit event reconstructed twice returned byte-identical snapshots (2700 bytes, zero diffs), and the counterfactual query left plan and audit outputs identical before and after (3455 and 3625 bytes). Added a labeled recorded fixture so judges can compare offline reference values against visibly distinct live records. No dev-deployment environment variables are set, so real OpenAI, Firecrawl, and inbox cutover stays blocked on keys; production deploy and public URL need explicit consent (`fixtures/demo-scenario.json`, `src/components/DemoRail.tsx`, `IMPLEMENTATION_PLAN.md`).

### 2026-09-03 - 3a21d30
Added a free live LLM lane: Groq is preferred via its OpenAI-compatible endpoint, direct OpenAI works through the same path, and missing keys or any live failure degrade to the deterministic mock with the ledger recording live vs mock per run. Extraction prompts forbid guessing (nulls become abstentions) and clarification drafts are phrased live from unresolved fields only. Verified with no keys on dev: extraction returns providerStatus mock with correct values; 11 unit tests pass; production build passes. Live Groq activates when a key is set on the deployment (`convex/lib/llm.ts`, `convex/actions/extract.ts`, `convex/actions/clarify.ts`, `convex/health.ts`).

### 2026-09-03 - 4b74253
Proved the live Groq lane on dev with a key set server-side: Spanish email extracted live at 0.97 confidence, the vague plan-input email extracted live with zero values and needs_review (abstention holds on the live lane), and the clarification draft returned a live targeted question naming exactly the unresolved fields. The ledger shows groq extract live runs with provider request IDs alongside the earlier failed attempts, which caught two real issues: retired model names now default to a live catalog model, and plain-text calls omit JSON mode. 11 tests pass; build passes (`convex/lib/llm.ts`, `convex/actions/clarify.ts`).

### 2026-09-03 - f7fc794
Proved the live AgentMail lane on dev with an inbox-scoped key: the key resolves to one real inbox, a test send returned a real message ID and thread, and the new send action mailed a real RFQ for the demo need with provider thread and message IDs stored on the thread record. Re-sending returns the same IDs without duplicating mail, and the ledger shows the live send with recipient evidence. Demo mail is addressed to the app inbox itself so no external party is mailed; supplier addresses stay synthetic until production (`convex/lib/agentmail.ts`, `convex/actions/sendRfq.ts`, `convex/rfq.ts`).

### 2026-09-03 - d313275
Added the Firecrawl live scrape lane with the key set server-side, but the key returns out-of-credits on every scrape including the account balance check, so no live scrape is claimed. The failure path itself is proven: a real recall verification recorded a failed run with the provider error and URL, then stored the labeled mock fallback without crashing. The lane goes live with no code change once credits land; the 20k hackathon coupon or a fresh account key are the two routes. 16 tests pass; build passes (`convex/lib/firecrawl.ts`, `convex/actions/verify.ts`).

### 2026-09-03 - live-judge-run
Ran the whole project live as judge on dev: 3 real RFQ sends with distinct provider thread IDs, live EN extraction at 0.99 verified, live abstention on the vague email, live targeted clarification draft, live approval-gated clarification send with a real thread ID, live CPSC recall scrape stored as source evidence, recall drift to 30/100 with replacement recovery to 100/100, 6-event replay chain, and a side-effect-free counterfactual saving $240. Judge findings fixed in the next commit: clarification send was mock-only and is now a real send; mock fallback code was removed from all three provider actions so failures throw instead of faking.

### 2026-09-03 - 97aba95
Removed every mock fallback lane: extraction, verification, and clarification drafting now require live providers and throw after recording failed runs; clarification approval sends a real email instead of flipping a status. Deleted the caller-less fabricated bulk verification. Genuine ambiguity still abstains through nulls and needs_review rather than hallucinating. Re-verified live after the cutover: EN extraction live at 0.99, abstention live, clarification draft and send live with real thread IDs, CPSC scrape live. 16 tests pass; build passes (`convex/actions/extract.ts`, `convex/actions/verify.ts`, `convex/actions/clarify.ts`, `src/components/OfferMatrix.tsx`).

### 2026-09-03 - c412ccd
Red-teamed with five black-box personas (coordinator, adversarial supplier, auditor, chaos, scale) and fixed what they found, each fix re-verified live: approvals now require proposed status, non-empty cover, and named approver, with double-approve and retired-plan approval rejected and a single-award invariant retiring sibling plans; recompute is idempotent on identical inputs and mints no plan for zero offers; allocation traces carry explicit shortfall lines; needs, incidents, offers, and thread statuses validate inputs; divergent email replays are rejected while identical ones return the same record; every mutation now threads the incident ID so the replay timeline covers real user flows including approvals; plan reads expose the approval record; global offer listing is capped. Known and documented, not fixed: no auth or tenant isolation (valid for a no-auth submission, required before multi-org production), supplier self-assertion at the write path, and free-form validator errors surfacing as server errors (`convex/allocations.ts`, `convex/needs.ts`, `convex/incidents.ts`, `convex/offers.ts`, `convex/rfq.ts`, `convex/lib/allocate.ts`).

### 2026-09-04 - fee85f3
Drove the app in a real Chromium browser (screenshots plus a recorded demo video in `e2e/`). The browser caught a production crash no CLI test could: approving a plan blanked the entire app because the approval audit snapshot lacked the need block the replay panel reads. Fixed with full snapshots on approval, null-safe replay rendering, snapshot-less legacy events replaying as metadata-only, and an error boundary so one bad event can never blank the app again; re-ran the whole flow with zero console, page, or request errors. Also closed the last mock send (hold notices now go live via AgentMail after approval) and corrected stale UI copy the screenshots exposed. Mobile 390px verified working (`convex/allocations.ts`, `convex/replay.ts`, `convex/evidenceDrift.ts`, `convex/actions/holdNotice.ts`, `src/components/DecisionReplay.tsx`, `e2e/demo-flow.webm`).

### 2026-09-05 - platform depth
Used the platform properly instead of hand-rolling: rate-limiter guards every billable lane, per-need coverage aggregates replace table scans, presence shows live coordinators, full-text search covers incidents/needs/suppliers, cert evidence attaches through file storage, an hourly watchdog cron escalates at-risk needs with one digest email, provider runs paginate, anonymous auth signs browsers in with zero friction and approvals now carry the server session subject, official AgentMail/Firecrawl components replaced raw fetch (verified live), drift recovery runs as a durable workflow with a human gate (completed end-to-end with recoveredQty 100), a coordinator agent answers from live tools in chat UI, and 6 convex-test integration tests prove guards and forged-identity rejection in-memory. 22 tests pass; deployment insights read healthy. Two documented gaps: the AgentMail component v0.1.0 cannot see deployment keys so its send workpool stays pending (direct proven sender remains primary; component kept for verified inbound ingest), and vector search is code-complete behind an embeddings key. Plan ledger 36/47 (`convex/*`, `src/*`).

### 2026-09-05 - vectors live + prod user run
Set the embeddings key server-side and brought vectors live: corrected the retired embedding model to gemini-embedding-001 at 768 dims, backfilled all offer versions, and verified semantic search returns ranked suppliers with real cosine scores, including through the agent's new similar-suppliers tool. Then ran the app as two real coordinators in isolated browsers: presence facepile, incident search, semantic agent answers, in-UI cert upload with chip, recall with live hold-notice send, replacement, approval, sliders — zero console, page, or request errors. The run caught three issues, all fixed and re-verified: agent reasoning traces leaking into chat (filtered to text parts only), synthetic mock runs corrupting provider health pills (ledger now stores real attempts only), and reset leaving orphaned attachment blobs (cleanup added). Proof shots in `e2e/`. Plan ledger 37/47 (`convex/embeddings.ts`, `src/components/CoordinatorChat.tsx`).

### 2026-09-05 - inbound delivery proven
With the webhook secret set, unsigned posts to the ingest route are rejected with 401, and a real supplier-style email from an external mailbox arrived end-to-end: provider delivery, signed webhook, deduped component ingest with labels and thread linkage, all queryable from the app with extracted text. The reply-to-offer mapping stands ready for the first genuine supplier reply to an RFQ thread. No addresses or message content recorded here by policy (`convex/http.ts`, `convex/email.ts`).

### 2026-09-05 - issues resolved
Worked through the open-issue list and resolved everything resolvable without new credentials: purged all red-team scratch incidents (adding a reusable purge mutation, and fixing a real aggregate corruption found along the way with a clear-plus-rebuild repair plus tolerant deletes); proved two-browser drift sync with zero reload and single-winner approval races across isolated sessions; recorded replaced-plan lineage on every approval; added need-level reviewing presence to the offer matrix; committed the build log after a clean PII scan. Remaining rows are credential- or console-side: per-need inbox creation (scoped key), OpenAI lane (no key), genuine reply-match proof, public bulletin scrape, prod deploy and submission. Plan ledger 40/47; full browser regression green with zero errors.
