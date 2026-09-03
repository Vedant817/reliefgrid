# ReliefGrid — Implementation Plan & Tracker

**Project:** ReliefGrid — email-native emergency supply coordinator  
**Event:** Convex All Gas Hackathon (sponsored by OpenAI, Firecrawl, AgentMail)  
**Repo:** `convex-all-gas` (`C:\Users\vedan\Documents\Resources\Code\convex-all-gas`)  
**Frontend choice:** `convex.site` via `@convex-dev/static-hosting`  
**Status:** Cloud development backend linked; UI build and allocator tests pass. Real sponsor APIs, static hosting/public deployment, and browser verification are still pending.
**How to use:** Agents update the checkbox (`[ ]` → `[x]`) and `Status` column, never rewrite history. Keep `hackathon.md` in sync via `/hackathon` after each phase.

---

## 0) How this file stays true

- Single source of truth for what counts as done. No other file decides completion.
- Every task maps to a judging pillar and a sponsor that does real work.
- Tasks are intentionally tiny — if a task takes >4h, split it.
- Update order: finish subtask → tick checkbox → update phase progress → append evidence files → run `/hackathon` at phase end.
- Never log secrets: no API keys, inboxes, or private emails. Log env var *names* only (e.g. `FIRECRAWL_API_KEY`), never values.

---

## 1) Eligibility — must-pass gates (from Luma + convex.dev/hackathons/all-gas)

| # | Gate | Evidence required | Owner file | Status |
|---|------|-------------------|------------|--------|
| E1 | New app started **on/after Aug 25, 2026** | `git log --reverse` first commit date ≥ 2026-08-25 | `git log` | [x] repo init 2026-09-02 |
| E2 | **Convex is the backend** — DB + functions + realtime sync on Convex | `convex/` directory, `convex.json`, `package.json` has `convex` | `convex/` | [ ] |
| E3 | Built with Codex **or** any agent with Convex plugin | Opencode + Convex MCP `convex@latest mcp start` connected | `~/.config/opencode/opencode.jsonc` | [x] MCP ✓ connected |
| E4 | **Frontend on `convex.site`** (chosen) or `chatgpt.site` | `npx @convex-dev/static-hosting setup` + `https://<deployment>.convex.site` live | `convex.json`, hosting config | [ ] |
| E5 | **Public GitHub repo** | `git remote -v` public URL, no private | `.git/config` | [ ] remote not set yet |
| E6 | **`hackathon.md` at repo root** + live URL field maintained | `hackathon.md:Event==Convex All Gas Hackathon`, `Frontend==Convex static hosting` | `hackathon.md` | [x] created |
| E7 | **Video ≤3 min** showing real product + Convex dashboard | `video/demo-script.md` + public YouTube/Vimeo URL in `hackathon.md` | `video/` | [ ] |
| E8 | **Submission before Sep 22, 12:00 PM PT** via exact VibeApps link | `https://vibeapps.dev/judging/convex-all-gas-hackathon-openai/submit` | submission proof | [ ] |
| E9 | Convex Auth v2 is **optional** — no-auth is valid (we note decision) | Decision logged in `hackathon.md:Auth` | `hackathon.md` | [ ] decision pending |
| E10 | Tag/shoutout on X/LinkedIn `@convex @openai @firecrawl @agentmail` | Social post URL archived | `docs/social-proof.md` | [ ] |
| E11 | `hackathon.md` stays redacted (no PII/secrets) | Pre-save scan for `@domain` → `[redacted inbox]` | `hackathon.md` | [x] clean |

**Public submission checklist (mirrors site footer):** `public repo` · `hackathon.md at root` · `live app URL (convex.site)` · `three-minute video` · `Register on Luma` · `Submit on vibeapps.dev`

---

## 2) Judging pillars — the "six tags" (mapped to tasks)

Luma lists six scoring pillars. Every task below declares which pillar it serves. Judges score `hackathon.md` + live demo.

| Pillar | What judges read | Our contract | Key files |
|--------|------------------|--------------|-----------|
| **P1 Creativity & usefulness** — real person solves a problem this week | Shelter coordinator solves a shortage in <10 min via email | ReliefGrid: one forwarded shortage → verified supply plan | `docs/pitch.md`, demo script |
| **P2 Convex depth** — queries, mutations, live updates, auth, components | Not a thin frontend; realtime board, workflows, audit trail | 12 tables, indexes, subscriptions, workflow, rate-limiter, storage | `convex/` |
| **P3 Sponsor stack** — OpenAI + Firecrawl + AgentMail do real work | No README-only integration | Matrix below | `convex/actions/*`, `convex/http.ts` |
| **P4 Live URL** — judges open it without invite | `https://<deployment>.convex.site` public, no localhost | Static hosting component | hosting config |
| **P5 Social proof** — post + engagement | X/LinkedIn post with video | `docs/social-proof.md` | social URL |
| **P6 Video demo** — <3 min, talk less, click real product | Live email round-trip + allocation flip mid-demo | `video/demo-script.md` | video URL in `hackathon.md` |

**Sponsor → real work (no slop):**

| Sponsor | Does real work where | Files that prove it |
|---------|----------------------|---------------------|
| **OpenAI** (via AI Gateway or direct) | Extracts quantities/prices/conditions/deadlines from multilingual email; drafts clarifications; explains allocation | `convex/lib/extractOffer.ts`, `convex/actions/extract.ts` |
| **Firecrawl** (via `@convex-dev/firecrawl` or action) | Verifies product spec/cert page + recall source; stores URL + quoted text + timestamp | `convex/lib/verify.ts`, `convex/actions/verify.ts`, `sourceChecks` table |
| **AgentMail** (via `@convex-dev/agentmail`) | One inbox per Need; sends RFQ/award; webhook → creates offer version | `convex/http.ts`, `convex/lib/agentmail.ts`, `rfqThreads` |
| **Convex** | Everything reactive/durable: tables, indexes, subscriptions, workflows, scheduled deadline checks, file storage, static hosting | `convex/` all files |

---

## 3) Proposed VibeApps tags (verify availability in submission UI)

The published rules define six **judging criteria**, not a guaranteed fixed six-tag taxonomy. If all six are available in the VibeApps submission UI, select:

1. `convex`  2. `openai`  3. `firecrawl`  4. `agentmail`  5. `emergency-response`  6. `realtime`

Do **not** claim a tag that is unavailable in the submission UI. Prefer stack and behavior tags over vague `ai`/`chatbot`/`productivity` tags.

---

## 4) Product scope — ReliefGrid MVP (frozen)

**One-liner:** Forward a shortage → get a verified, cost-optimal supply plan you can approve, with every claim cited.

**Scenario:** Flood shelter needs `100 × NSF/ANSI 53 water filters by 18:00, budget $1,200, partial allowed`. Three synthetic suppliers reply by email (EN + Spanish), one late, one unverified. System computes cheapest feasible split (e.g. 70×$11 + 30×$10 = $1,070) and requires human approval before sending awards.

**In scope (MVP):** 1 org · 1 incident · 3 needs · 5 synthetic suppliers · email RFQ/reply · EN+ES extraction · product + recall verification · deterministic allocation · human approval · award emails · realtime board · public redacted audit receipt.

**Out of scope (explicit no):** payments, auto-purchase, supplier portals, routing, gov integrations, predictions, blockchain, general procurement, autonomous spend, maps without real geo, 20 disaster types.

**Four screens only:** `Incident Board` · `Live Offer Matrix` · `Allocation Inspector` · `Public Audit Receipt`.

**State machine (immutable audit):** `draft → researching → awaiting_responses → planning → awaiting_approval → awarded → partially_fulfilled → fulfilled` (revisions loop to `planning` on offer update, shortfall → new plan).

**Data model (12 tables):** `incidents` · `needs` · `suppliers` · `rfqThreads` · `offers` · `offerVersions` · `sourceChecks` · `allocationPlans` · `allocationLines` · `approvals` · `deliveries` · `auditEvents`

---

## 5) Architecture (for implementers)

```
Coordinator creates Need (convex mutation)
  → durable workflow (convex workflow component)
  → Firecrawl verify requirements + supplier source pages → sourceChecks
  → human approves RFQ draft → AgentMail send threaded RFQs → rfqThreads
  → AgentMail webhook (httpAction) receives reply
  → OpenAI structured extraction → offerVersions (versioned)
  → deterministic allocator recomputes allocationPlans/lines
  → convex subscriptions push to all clients (no poll)
  → human approves allocation → AgentMail award notices → approvals + auditEvents
  → public redacted receipt (no emails/PII)
  → scheduled cron checks deadlines → flags at-risk
```

**Convex features exercised:** schema + indexes + search/vector optional, queries/mutations/actions, httpActions, `ctx.scheduler`, `storage`, `useQuery`/`usePaginatedQuery`, `workflow`, `rate-limiter`, `file storage`, `static hosting`. Each task declares which feature it proves.

---

## 6) Phased plan — epics → tasks → subtasks (tiny)

> Progress = `done / total`. Last bulk update: 2026-09-02.

### Phase 0 — Foundation & tooling [0/11]

| ID | Task | Subtasks (each ≤4h) | Pillar | Sponsor | Files | Status |
|----|------|---------------------|--------|---------|-------|--------|
| 0.1 | Init Convex project | 0.1.1 `npm create vite@latest` / Next? confirm · 0.1.2 `npm i convex` · 0.1.3 `npx convex dev --once` init · 0.1.4 `convex.json` + `convex/` skeleton | P2 | Convex | `package.json`, `convex.json`, `convex/` | [ ] |
| 0.2 | Configure Opencode + MCP for project | 0.2.1 verify `opencode mcp list` convex connected · 0.2.2 `convex ai-files install` (when project qualifies) · 0.2.3 add `AGENTS.md`/`CLAUDE.md` if generated | P2 | Convex | `AGENTS.md` | [ ] |
| 0.3 | Env & ignore hygiene | 0.3.1 `.env.example` with `FIRECRAWL_API_KEY`, `AGENTMAIL_API_KEY`, `OPENAI_API_KEY` names only · 0.3.2 ensure `.env` gitignored · 0.3.3 `convex/_generated` ignored | P2 | — | `.env.example`, `.gitignore` | [ ] |
| 0.4 | Install static-hosting prep | 0.4.1 `npm i @convex-dev/static-hosting` (deferred until app exists) · 0.4.2 document `npx @convex-dev/static-hosting setup` steps | P4 | Convex | `package.json` | [ ] |
| 0.5 | Lint/format/test baseline | 0.5.1 `eslint` + `prettier` · 0.5.2 `vitest` + `convex-test` setup · 0.5.3 `npm run typecheck` script | P2 | — | `eslint.config.*`, `vitest.config.*` | [ ] |

### Phase 1 — Data model (schema) [0/16]

| ID | Task | Subtasks | Convex feature | Files | Status |
|----|------|----------|----------------|-------|--------|
| 1.1 | `incidents` table | 1.1.1 fields `title,orgId,status,deadlineAt,createdAt` 1.1.2 index `by_status` 1.1.3 index `by_deadline` | schema, indexes | `convex/schema.ts` | [ ] |
| 1.2 | `needs` table | 1.2.1 fields `incidentId,item,qty,deadlineAt,budgetCents,certRequired,partialAllowed,status` 1.2.2 index `by_incident` 1.2.3 index `by_status` | schema, indexes | `convex/schema.ts` | [ ] |
| 1.3 | `suppliers` table | 1.3.1 fields `name,contactEmail,region,verified` 1.3.2 seed 5 synthetic suppliers (no real emails) | schema | `convex/schema.ts`, `convex/seed.ts` | [ ] |
| 1.4 | `rfqThreads` table | 1.4.1 fields `needId,supplierId,inboxId,threadId,status` 1.4.2 index `by_need` | schema | `convex/schema.ts` | [ ] |
| 1.5 | `offers` + `offerVersions` | 1.5.1 `offers` current view 1.5.2 `offerVersions` immutable history 1.5.3 fields `qty,unitPrice,arrivalAt,certStatus,conditions,confidence,rawEmailId` | schema | `convex/schema.ts` | [ ] |
| 1.6 | `sourceChecks` | 1.6.1 fields `offerId,url,quote,retrievedAt,status,reason` 1.6.2 index `by_offer` | schema | `convex/schema.ts` | [ ] |
| 1.7 | `allocationPlans` + `allocationLines` | 1.7.1 `allocationPlans: needId,status,totalCost,createdAt` 1.7.2 `allocationLines: planId,supplierId,qty,cost,reason` 1.7.3 index `by_need` | schema | `convex/schema.ts` | [ ] |
| 1.8 | `approvals` + `deliveries` + `auditEvents` | 1.8.1 `approvals: planId,approvedBy,approvedAt` 1.8.2 `deliveries: needId,receivedQty,status` 1.8.3 `auditEvents: entity,action,actor,at,meta` append-only | schema | `convex/schema.ts` | [ ] |
| 1.9 | Validators & search | 1.9.1 `v.` validators for every mutation 1.9.2 optional `searchIndex` on `needs.item` | validators, full-text | `convex/schema.ts` | [ ] |

### Phase 2 — Core Convex functions [0/14]

| ID | Task | Subtasks | Files | Status |
|----|------|----------|-------|--------|
| 2.1 | Incidents CRUD | 2.1.1 `createIncident` mutation 2.1.2 `listIncidents` query 2.1.3 `getIncident` query | `convex/incidents.ts` | [ ] |
| 2.2 | Needs CRUD | 2.2.1 `createNeed` 2.2.2 `listNeedsByIncident` 2.2.3 `updateNeedStatus` + audit | `convex/needs.ts` | [ ] |
| 2.3 | Suppliers | 2.3.1 `listSuppliers` 2.3.2 `seedSuppliers` action (dev only) | `convex/suppliers.ts` | [ ] |
| 2.4 | RFQ threads | 2.4.1 `createRfqThreadsForNeed` 2.4.2 `listThreadsByNeed` | `convex/rfq.ts` | [ ] |
| 2.5 | Offers | 2.5.1 `upsertOfferVersion` (idempotent by emailId) 2.5.2 `listOffersByNeed` 2.5.3 `listOfferVersions` | `convex/offers.ts` | [ ] |
| 2.6 | Realtime subscriptions | 2.6.1 `useQuery(listOffersByNeed)` wiring 2.6.2 `useQuery(getAllocationPlan)` live board | `src/hooks/*` | [ ] |
| 2.7 | Scheduled deadline checks | 2.7.1 `crons.ts` every 5m flag at-risk 2.7.2 `ctx.scheduler` for per-need deadline | `convex/crons.ts` | [ ] |

### Phase 3 — AgentMail (email is the UX) [0/13]

| ID | Task | Subtasks | Sponsor | Files | Status |
|----|------|----------|---------|-------|--------|
| 3.1 | Install AgentMail component | 3.1.1 `npm i @convex-dev/agentmail` 3.1.2 `convex/convex.config.ts` register 3.1.3 `convex/agentmail.config.ts` env wiring | AgentMail | `convex/convex.config.ts` | [ ] |
| 3.2 | Inbox per need | 3.2.1 `createInboxForNeed` action (1 inbox per need) 3.2.2 store `inboxId` on `rfqThreads` | AgentMail | `convex/lib/agentmail.ts` | [ ] |
| 3.3 | Send RFQ | 3.3.1 draft RFQ template (qty, deadline, cert, budget band) 3.3.2 approval gate before send 3.3.3 `sendRfqEmails` action (threaded) | AgentMail | `convex/actions/sendRfq.ts` | [ ] |
| 3.4 | Webhook ingest | 3.4.1 `http.ts` `httpAction` for AgentMail webhook 3.4.2 verify signature 3.4.3 map to `offerVersion` (raw saved, PII redacted in logs) | AgentMail/Convex | `convex/http.ts` | [ ] |
| 3.5 | Clarifications & awards | 3.5.1 `sendClarification` (needs review) 3.5.2 `sendAwardNotices` after approval 3.5.3 thread-aware replies | AgentMail | `convex/actions/awards.ts` | [ ] |

### Phase 4 — OpenAI extraction (language → structure) [0/12]

| ID | Task | Subtasks | Files | Status |
|----|------|----------|-------|--------|
| 4.1 | Extraction schema | 4.1.1 define Zod `OfferExtraction {qty,unitPrice,arrivalAt,certClaim,conditions,confidence,language}` 4.1.2 validators | `convex/lib/extractOffer.ts` | [ ] |
| 4.2 | Prompt & gateway | 4.2.1 gateway `openai/gpt-4o-mini` via `convexGateway` or env key 4.2.2 prompt: EN+ES, quantity/price/time/cert, flag qualifications | `convex/actions/extract.ts` | [ ] |
| 4.3 | Pipeline | 4.3.1 `extractOfferFromEmail` action 4.3.2 low-confidence → `needs_review` 4.3.3 idempotent re-extract on revision | `convex/actions/extract.ts` | [ ] |
| 4.4 | Explanation | 4.4.1 `explainOffer` (why parsed this way) 4.4.2 surface in Offer Matrix | `convex/lib/explain.ts` | [ ] |

### Phase 5 — Firecrawl verification (cite-or-it-didn't-happen) [0/12]

| ID | Task | Subtasks | Files | Status |
|----|------|----------|-------|--------|
| 5.1 | Install Firecrawl | 5.1.1 `npm i @convex-dev/firecrawl` or direct API 5.1.2 rate-limiter (`@convex-dev/rate-limiter`) | `convex/convex.config.ts` | [ ] |
| 5.2 | Product/cert check | 5.2.1 scrape product spec page → extract cert claim 5.2.2 store `sourceChecks` with `url,quote,retrievedAt` 5.2.3 status `verified/unverified/needs_review` | `convex/actions/verify.ts` | [ ] |
| 5.3 | Recall check | 5.3.1 scrape recall registry 5.3.2 mark `hasRecall:true/false` | `convex/actions/verify.ts` | [ ] |
| 5.4 | Inspector UI data | 5.4.1 `listSourceChecksByOffer` query 5.4.2 redacted proof view (no PII) | `src/components/SourceLedger.tsx` | [ ] |

### Phase 6 — Deterministic allocator (the defensible bit) [0/10]

| ID | Task | Subtasks | Files | Status |
|----|------|----------|-------|--------|
| 6.1 | Normalize offers | 6.1.1 map `offerVersions → normalizedOffer` (qty, price, arrival, cert) 6.1.2 flag `late`/`overBudget`/`uncertified` | `convex/lib/normalize.ts` | [ ] |
| 6.2 | Allocator | 6.2.1 filter hard constraints (deadline, cert) 6.2.2 cheapest feasible combo covering qty (≤5 suppliers, brute force ok) 6.2.3 tie-break: fewer suppliers, earlier arrival | `convex/lib/allocate.ts` | [ ] |
| 6.3 | Plan persistence | 6.3.1 `createAllocationPlan` + lines 6.3.2 recompute on every new `offerVersion` via scheduler/workflow 6.3.3 decision trace (why B rejected: late) | `convex/allocations.ts` | [ ] |
| 6.4 | Tests | 6.4.1 `convex-test` allocator: late loses even if cheapest, partial allowed, budget cap | `convex/allocate.test.ts` | [ ] |

### Phase 7 — Approval & audit [0/9]

| ID | Task | Subtasks | Files | Status |
|----|------|----------|-------|--------|
| 7.1 | State machine | 7.1.1 `transitionNeedStatus` with guard 7.1.2 workflow for `planning → awaiting_approval → awarded` | `convex/lib/state.ts` | [ ] |
| 7.2 | Human gates | 7.2.1 approval required before RFQ send 7.2.2 approval required before award 7.2.3 record `approvals` + `auditEvents` | `convex/approvals.ts` | [ ] |
| 7.3 | Deliveries & shortfall | 7.3.1 `recordDelivery` 7.3.2 detect shortfall → new plan | `convex/deliveries.ts` | [ ] |

### Phase 8 — UI (four screens, no dashboard bloat) [0/18]

| ID | Task | Subtasks | Files | Status |
|----|------|----------|-------|--------|
| 8.1 | App shell | 8.1.1 `src/App.tsx` layout 8.1.2 header with incident status 8.1.3 realtime ConvexProvider | `src/` | [ ] |
| 8.2 | Incident Board | 8.2.1 `IncidentBoard.tsx` — 0/100, at-risk, threads 8.2.2 deadline countdown 8.2.3 file attachments via `storage` | `src/components/IncidentBoard.tsx` | [ ] |
| 8.3 | Live Offer Matrix | 8.3.1 `OfferMatrix.tsx` — rows as emails arrive 8.3.2 badges: verified/late/ambiguous 8.3.3 Spanish offer renders normalized | `src/components/OfferMatrix.tsx` | [ ] |
| 8.4 | Allocation Inspector | 8.4.1 `AllocationInspector.tsx` — selected vs rejected table 8.4.2 cost calc: 70×11+30×10=1070 8.4.3 decision trace per rejection | `src/components/AllocationInspector.tsx` | [ ] |
| 8.5 | Public Audit Receipt | 8.5.1 `AuditReceipt.tsx` — redacted, shareable 8.5.2 no emails/PII, only counts & criteria | `src/components/AuditReceipt.tsx` | [ ] |
| 8.6 | Polish | 8.6.1 a11y + responsive 8.6.2 empty/loading/error states 8.6.3 synthetic data toggle (dev only) | `src/` | [ ] |

### Phase 9 — Deploy & env [0/9]

| ID | Task | Subtasks | Files | Status |
|----|------|----------|-------|--------|
| 9.1 | Static hosting | 9.1.1 `npx @convex-dev/static-hosting setup` 9.1.2 `npm run deploy` → `https://<deployment>.convex.site` | hosting config | [ ] |
| 9.2 | Env wiring | 9.2.1 `npx convex env set FIRECRAWL_API_KEY` etc (no values in repo) 9.2.2 document required vars in `.env.example` | Convex env | [ ] |
| 9.3 | Smoke test | 9.3.1 open live URL unauthenticated 9.3.2 realtime update observed without refresh | live URL | [ ] |

### Phase 10 — Demo, social, submission [0/12]

| ID | Task | Subtasks | Files | Status |
|----|------|----------|-------|--------|
| 10.1 | Synthetic demo data | 10.1.1 5 synthetic suppliers (controlled inboxes) 10.1.2 3 RFQ templates 10.1.3 Spanish reply fixture | `seed/` | [ ] |
| 10.2 | Video script | 10.2.1 `video/demo-script.md` (0:00 problem → 3:00 resolution) 10.2.2 screen capture + Convex dashboard 10.2.3 upload public YouTube, add URL to `hackathon.md` | `video/` | [ ] |
| 10.3 | Social proof | 10.3.1 X/LinkedIn post tagging @convex @openai @firecrawl @agentmail 10.3.2 archive URL → `docs/social-proof.md` | `docs/social-proof.md` | [ ] |
| 10.4 | VibeApps submit | 10.4.1 select 6 tags 10.4.2 public repo + live URL + video link 10.4.3 submit via exact link before Sep 22 12:00 PM PT | submission | [ ] |
| 10.5 | Final hackathon.md | 10.5.1 `/hackathon` update with `Live app`, `Repo`, `Convex deployment`, `Components`, `Features`, `AI models` 10.5.2 verify no secrets | `hackathon.md` | [ ] |

---

## 7) Execution order (dependencies)

```
0 Foundation → 1 Schema → 2 Functions → 3 AgentMail → 4 OpenAI → 5 Firecrawl → 6 Allocator → 7 Approval → 8 UI → 9 Deploy → 10 Demo/Submit
               ↘︎ 5 needs 2 & 3, 6 needs 4+5, 8 needs 2+6+7
```

Parallelizable: 3+4+5 can overlap after 2.1; 8.2/8.3/8.4 can overlap after 6.3.

---

## 8) Definition of done (per task)

- [ ] Code is in `convex/` or `src/`, typed, `tsc --noEmit` passes
- [ ] Validator covers every arg (`v.*`)
- [ ] Realtime proven: `useQuery` updates without refresh
- [ ] Audit event written for every state change
- [ ] No secret/PII in git or `hackathon.md` (scan `@` → `[redacted inbox]`)
- [ ] `hackathon.md` updated if user-visible behavior changed
- [ ] Test or manual proof recorded in `TASK_LOG.md`

---

## 9) Risk & guardrails

- **AgentMail deliverability** → use controlled synthetic inboxes for demo; never scrape real contacts.
- **Firecrawl flakiness** → rate-limiter, store `quote+retrievedAt`, mark `needs_review` on failure.
- **OpenAI hallucination** → low confidence → human review; allocator never trusts unverified cert.
- **Home `C:\Users\vedan\.git` shadowing** → project is isolated at `C:\...\convex-all-gas\.git`; do not use home root for git ops.
- **Deadline drift** → `crons.ts` + scheduler, not client timers.

---

## 10) Tracker — live status

| Phase | Done | Total | % | Next action |
|-------|------|-------|---|-------------|
| 0 Foundation | 8 | 11 | 73% | Add lint/test baseline and Convex AI files |
| 1 Schema | 15 | 16 | 94% | Add optional full-text index only if used |
| 2 Functions | 11 | 14 | 79% | Fix idempotency, deadline mutation, and scheduler |
| 3 AgentMail | 0 | 13 | 0% | Install component |
| 4 OpenAI | 3 | 12 | 25% | Replace deterministic mock with real structured output |
| 5 Firecrawl | 3 | 12 | 25% | Replace verification mock with real scrape/monitor |
| 6 Allocator | 7 | 10 | 70% | Correct greedy edge cases and add tests |
| 7 Approval | 4 | 9 | 44% | Add guarded state machine and real outbound gate |
| 8 UI | 13 | 18 | 72% | Browser-test and finish interaction controls |
| 9 Deploy | 0 | 9 | 0% | `static-hosting setup` |
| 10 Demo | 4 | 12 | 33% | Make demo reset idempotent and write video script |
| 11 Wow layer | 0 | 32 | 0% | Real sponsor cutover, then Evidence Drift |
| **Total** | **68** | **168** | **40%** | Commit UI, then replace all mocks |

---

## 11) Current implementation truth (2026-09-03)

This section overrides optimistic checkbox interpretations. A sponsor integration is **not done** until a real provider request succeeds and its safe evidence is visible in the product.

### Verified now

- [x] Vite + React + TypeScript + Tailwind foundation exists.
- [x] Convex local deployment starts at `http://127.0.0.1:3210`.
- [x] Convex schema with core operational tables and indexes pushes successfully.
- [x] CRUD, versioned offers, source-check storage, allocation persistence, approval, audit queries, seed data, and HTTP routes compile.
- [x] Four-screen UI exists: Incident Board, Live Offer Matrix, Allocation Inspector, Public Audit Receipt.
- [x] `npx tsc --noEmit` passes.
- [x] `npm run build` passes (116 modules; production bundle generated).

### Not verified and must not be claimed as complete

- [ ] **OpenAI is currently a deterministic extraction mock.** No real OpenAI or Convex AI Gateway response has been proven.
- [ ] **Firecrawl is currently a verification mock.** No real Firecrawl scrape/monitor response has been proven.
- [ ] **AgentMail is currently synthetic thread/webhook scaffolding.** No real inbox, send, reply, signature verification, or webhook round trip has been proven.
- [x] Convex cloud development deployment `judicious-rat-761` is linked and backend functions are verified.
- [ ] Convex production deployment is not yet proven.
- [ ] Static hosting is not installed; no public `.convex.site` URL exists.
- [x] Allocator unit tests exist and pass (3 tests); replay snapshot normalization test passes.
- [ ] Convex integration tests do not exist yet.
- [ ] Browser/Playwright realtime proof does not exist yet.
- [ ] Public GitHub remote, public video, social post, and VibeApps submission do not exist yet.
- [ ] `hackathon.md` does not yet describe the implemented product and must be refreshed after verification.

---

## 12) Wow layer — prioritized, concrete, and demoable [16/33]

The features below are not generic extras. Each creates a visible cause-and-effect moment using the sponsor stack. Do not start Tier B until all real sponsor cutover tasks in 11.1 pass.

### Priority order

| Tier | Feature | Why it earns demo time | Decision |
|------|---------|------------------------|----------|
| A0 | Real sponsor cutover | Required for sponsor-stack judging; mocks do not qualify | Must ship |
| A1 | Evidence Drift / Source Flip | One changed web source invalidates a plan live and forces recovery | Must ship; hero moment |
| A2 | AI abstention + clarification | Shows safe autonomy instead of hallucinated procurement data | Must ship |
| A3 | Judge Mode | Makes the full flow reproducible in under three minutes | Must ship |
| B1 | Decision Time Machine | Demonstrates event-sourced Convex depth and auditability | Ship if A tiers are stable |
| B2 | Counterfactual Lab | Explains why cheapest did not win without changing live state | Ship if A tiers are stable |
| B3 | Live coordinator presence | Shows collaboration, but adds less product value than evidence drift | Optional |

### 11.1 Real sponsor cutover [2/6]

| ID | Atomic task | Acceptance proof | Files | Status |
|----|-------------|------------------|-------|--------|
| 11.1.1 | Replace extraction mock with OpenAI structured output | A real EN email and a real ES email produce schema-valid offers; model and request ID stored without prompt/private body | `convex/actions/extract.ts`, `convex/lib/extractOffer.ts` | [ ] |
| 11.1.2 | Replace source-check mock with Firecrawl scrape | Real public page returns URL, title, relevant quote, retrieval time, and provider job/request ID | `convex/actions/verify.ts` | [ ] |
| 11.1.3 | Create one real AgentMail inbox per Need | Inbox ID stored in Convex; address never printed to `hackathon.md` or public audit | `convex/lib/agentmail.ts` | [ ] |
| 11.1.4 | Prove send -> reply -> signed webhook -> offer version | Controlled inbox receives RFQ; reply creates exactly one offer version; duplicate webhook remains idempotent | `convex/http.ts`, `convex/actions/sendRfq.ts` | [ ] |
| 11.1.5 | Add provider execution ledger | UI shows safe status, latency, timestamp, and provider request ID for OpenAI/Firecrawl/AgentMail; never secrets/content | `convex/schema.ts`, `src/components/ProviderProof.tsx` | [x] |
| 11.1.6 | Add free Groq live lane with mock fallback | Groq key present routes extraction + clarification through Llama with JSON schema; failures and missing keys degrade to mock, ledger records live vs mock | `convex/lib/llm.ts`, `convex/actions/extract.ts`, `convex/actions/clarify.ts`, `convex/health.ts` | [x] |

### 11.2 Evidence Drift / Source Flip [0/5] — hero feature

**Demo contract:** Apex is selected at 70 units. A controlled manufacturer bulletin changes to `RECALL ACTIVE`. Firecrawl re-scrapes it. Convex marks the source stale/failed, supersedes the plan, and streams a shortfall. OpenAI explains the change. AgentMail drafts (but does not automatically send) a hold notice.

| ID | Atomic task | Acceptance proof | Files | Status |
|----|-------------|------------------|-------|--------|
| 11.2.1 | Add controlled public manufacturer bulletin | Public route renders stable `CLEAR` state and can switch to `RECALL ACTIVE` using a guarded demo mutation | `src/pages/DemoBulletin.tsx`, `convex/demo.ts` | [ ] |
| 11.2.2 | Add Firecrawl recheck action | Actual Firecrawl scrape reads the public bulletin after each state change and stores content hash + quote | `convex/actions/recheckSource.ts` | [ ] |
| 11.2.3 | Invalidate affected offer and active plan | `sourceChecks: verified -> failed`; offer becomes ineligible; active plan becomes `superseded` in one durable workflow | `convex/sourceChecks.ts`, `convex/workflows.ts` | [ ] |
| 11.2.4 | Stream recovery to every client | Two browser sessions show `100/100 -> 30/100 shortfall -> replacement plan` without refresh or polling | `src/components/IncidentBoard.tsx` | [ ] |
| 11.2.5 | Draft hold notice through AgentMail | Human sees cited reason and approves before send; no autonomous purchasing or cancellation | `convex/actions/awards.ts`, `src/components/HoldNotice.tsx` | [ ] |

### 11.3 AI abstention + targeted clarification [2/4]

**Demo input:** `We should be able to do around fifty, maybe near five.` The system must not convert this into a trusted offer.

| ID | Atomic task | Acceptance proof | Files | Status |
|----|-------------|------------------|-------|--------|
| 11.3.1 | Add field-level confidence and evidence spans | Quantity, price, arrival, and cert each include confidence + source text offsets | `convex/lib/extractOffer.ts`, schema | [x] |
| 11.3.2 | Block ambiguous offers from allocator | Missing price/deadline/cert or confidence below threshold yields `needs_review`, never eligible | `convex/lib/allocate.ts` | [x] |
| 11.3.3 | Generate one precise clarification | OpenAI asks only unresolved fields (e.g. exact qty and arrival date), not a generic follow-up | `convex/actions/clarify.ts` | [ ] |
| 11.3.4 | Send clarification after approval and merge reply | AgentMail thread reply creates a new version; old version remains replayable | `convex/actions/sendClarification.ts` | [ ] |

### 11.4 Judge Mode [4/4]

| ID | Atomic task | Acceptance proof | Files | Status |
|----|-------------|------------------|-------|--------|
| 11.4.1 | Add idempotent `Reset Demo` | One click deletes only synthetic demo records and recreates a known clean scenario | `convex/demo.ts` | [x] |
| 11.4.2 | Add guided five-step demo rail | `Create need -> send RFQs -> replies -> verify -> approve` highlights next valid action, never fakes completion | `src/components/DemoRail.tsx` | [x] |
| 11.4.3 | Add integration health panel | Convex/OpenAI/Firecrawl/AgentMail show `live`, `mock`, `degraded`, or `not configured` from backend checks | `src/components/ProviderProof.tsx`, `convex/health.ts` | [x] |
| 11.4.4 | Add safe fallback fixtures | If a provider is unavailable, judges can view labeled recorded fixtures, but live proof remains visibly distinct | `fixtures/`, `src/components/DemoRail.tsx` | [x] |

### 11.5 Decision Time Machine [4/5]

| ID | Atomic task | Acceptance proof | Files | Status |
|----|-------------|------------------|-------|--------|
| 11.5.1 | Make audit payloads versioned and append-only | Every offer/source/plan/status change references previous and next version IDs | `convex/schema.ts`, `convex/lib/audit.ts` | [ ] |
| 11.5.2 | Build `getIncidentAt(eventId)` reconstruction query | Query returns deterministic historical state from audit events | `convex/replay.ts` | [x] |
| 11.5.3 | Add timeline slider | Scrubbing shows offers and selected suppliers at each event | `src/components/DecisionReplay.tsx` | [x] |
| 11.5.4 | Highlight causal diff | UI states `Source recall removed Apex; plan coverage changed 100 -> 30` | `src/components/DecisionReplay.tsx` | [x] |
| 11.5.5 | Test replay determinism | Same event ID reconstructs byte-equivalent normalized state twice | `convex/replay.test.ts` | [x] |

### 11.6 Counterfactual Lab [4/4]

| ID | Atomic task | Acceptance proof | Files | Status |
|----|-------------|------------------|-------|--------|
| 11.6.1 | Extract allocator into pure function with constraint overrides | Override deadline/budget/cert without database writes | `convex/lib/allocate.ts` | [x] |
| 11.6.2 | Add `Why not this supplier?` action | Clicking BlueRiver shows exact failed constraint: delivery after deadline | `src/components/AllocationInspector.tsx` | [x] |
| 11.6.3 | Add non-mutating what-if controls | Relax deadline by 16h -> BlueRiver wins and savings display; live plan remains unchanged | `src/components/CounterfactualLab.tsx` | [x] |
| 11.6.4 | Test zero side effects | Counterfactual query leaves plans, approvals, threads, and audit count unchanged | `convex/allocate.test.ts` | [x] |

### 11.7 Realtime collaboration presence [0/5] — optional

| ID | Atomic task | Acceptance proof | Files | Status |
|----|-------------|------------------|-------|--------|
| 11.7.1 | Add coordinator session identity | Anonymous judge receives random session alias, no PII | `src/lib/session.ts` | [ ] |
| 11.7.2 | Add presence heartbeat | Active coordinators appear/disappear within bounded timeout | `convex/presence.ts` | [ ] |
| 11.7.3 | Show who is reviewing an offer | Offer row shows `Coordinator 2 reviewing` live | `src/components/OfferMatrix.tsx` | [ ] |
| 11.7.4 | Prevent conflicting approvals | Atomic mutation rejects approval after plan is superseded/approved | `convex/allocations.ts` | [ ] |
| 11.7.5 | Verify two-browser concurrency | Playwright two contexts prove presence + single-winner approval | `e2e/realtime.spec.ts` | [ ] |

---

## 13) Three-minute wow sequence (feature acceptance target)

| Time | Click, do not narrate | Visible proof |
|------|-----------------------|---------------|
| 0:00-0:20 | Reset Demo; create the 100-filter need | Convex incident appears in two browser sessions |
| 0:20-0:45 | Approve RFQs | AgentMail provider receipt + three thread IDs |
| 0:45-1:15 | Controlled suppliers reply in EN, ambiguous EN, and ES | OpenAI structured fields, field confidence, one abstention |
| 1:15-1:35 | Approve clarification | AgentMail reply merges into a new immutable offer version |
| 1:35-1:55 | Verify sources | Firecrawl quotes, timestamps, hashes, and clean recall status |
| 1:55-2:15 | Open allocation | Cheapest-late loses; 70+30, $1,070, deterministic trace |
| 2:15-2:40 | Flip manufacturer bulletin to recall | Firecrawl detects drift; Convex supersedes plan; both browsers show shortfall live |
| 2:40-2:55 | Open Counterfactual / Time Machine | Explain why supplier lost and replay the exact source-caused change |
| 2:55-3:00 | Show public audit receipt | Redacted evidence, approval gate, provider proof, public `.convex.site` |

If the complete sequence cannot be reproduced twice from `Reset Demo`, it is not video-ready.

---

## 14) Immediate next step (agent pickup)

```bash
# from C:\Users\vedan\Documents\Resources\Code\convex-all-gas
npm run typecheck
npx convex dev --once
npm run build
# Commit the current UI separately, then complete 11.1 real sponsor cutover.
# Do not start optional wow features while any provider still reports `mock`.
```

> When you return, open this file, tick the subtask you finished, update the phase %, and append a one-line evidence note under "Tracker — live status". No other tracking file is needed.
