# ReliefGrid Release Plan

## Product thesis

ReliefGrid turns supplier quote emails into a sourcing decision a team can defend. It converts email into comparable offers, proposes a deterministic human-approved sourcing plan, and freezes or reopens that plan when the evidence behind it changes. Flagship scenario: relief response; everyday fit: any small organization making an urgent purchase.

## Target user and job

- User: anyone who buys things for a small organization — office and facility managers, school administrators, clinic managers, event planners — with relief coordinators as the flagship example.
- Job: within 20 minutes, produce a defensible sourcing decision and show why every selected offer is safe, timely, affordable, and approved.
- Boundary: decision support and supplier correspondence, not payments, routing, autonomous purchasing, or an ERP replacement.

## Shipped product contract

- [x] Private incident workspaces derived from Convex Auth identity.
- [x] Real incident and requirement intake with location, timezone, budget, certification, and deadline.
- [x] Need-specific AgentMail inboxes and human-approved supplier RFQs.
- [x] Signed webhook ingest, event deduplication, thread matching, and supplier-sender validation.
- [x] Live LLM extraction with field evidence and abstention on ambiguous values.
- [x] Supplier certification claims remain untrusted until a source check promotes them.
- [x] Firecrawl source checks record claim, authority, exact match, quote, timestamp, and content hash.
- [x] Deterministic allocation; partial coverage remains a shortfall and cannot be awarded.
- [x] Human approval queues idempotent in-thread award and decline notices.
- [x] Real Firecrawl recheck of a public Convex bulletin drives evidence-drift invalidation.
- [x] Versioned offers, causal audit timeline, counterfactual analysis, and live subscriptions across workspace tabs.
- [x] Lint, typecheck, unit/integration tests, production build, and committed Playwright smoke tests.
- [x] First-visit hero on `/`: what the product is, who it is for, one-click sample scenario, trust line.
- [x] Public recall watch: Firecrawl searches CPSC/FDA/NSF for exact product identifiers; a confirmed match freezes offers transactionally, otherwise no writes.
- [x] Supplier discovery: Firecrawl web search prefills the supplier form; adding still requires a human-supplied email.
- [x] Everyday-product copy: proof panels behind "How was this decision made?", plain-language statuses, relative deadlines, dead shortfall button removed.
- [x] Provider send failures release their send claim and record a failed ledger run instead of stranding threads in "sending".
- [x] Buyer-facing reposition: generalized tagline, sample-scenario naming, decision history list, "How was this decision made?" disclosure, next-step banner, empty panels hidden until data exists.
- [x] Basket slice: multi-line-item request creation, one-click send-all RFQs, per-incident coverage summary.
- [x] Supplier reminders: human-approved nudges for unanswered RFQ threads with awaiting-reply counts.
- [x] Exportable decision report: quotes, winner rationale, evidence citations, approval, and history on one printable page.

Development certification: 35 unit/integration tests, two smoke journeys, three comprehensive functional browser journeys, two live Firecrawl/workflow journeys, and one live AgentMail/Groq round trip, plus production build, lint, typecheck, and full npm audit. The live browser proof observes coverage change `100 -> 30 -> 100` through both direct and durable human-approved recovery paths. The provider proof sends an approved RFQ between controlled AgentMail inboxes, ingests the signed in-thread reply, and persists Groq's extracted 25-unit offer at `$4.50` through the deployed development backend.

## Hackathon gates

| Gate | Current evidence | Status |
|---|---|---|
| Convex backend and realtime | `convex/`, subscriptions, components, workflows | Ready |
| Sponsor integrations | AgentMail and Firecrawl live; Groq live; direct OpenAI not yet proven | Partial |
| Public repository | No Git remote configured | External action required |
| Public frontend | No static hosting deployment configured | External action required |
| Three-minute video | Script exists at `video/demo-script.md`; recording/upload pending | External action required |
| Social post | Not published | External action required |
| Submission | Not submitted | External action required |

## Remaining release work

1. Obtain an OpenAI key or approved gateway and prove one structured extraction run; otherwise remove OpenAI from the sponsor claim.
2. Rotate every credential exposed during development before any public deployment.
3. Configure Convex static hosting and deploy the frontend after explicit production consent.
4. Create a public GitHub repository after a secret and PII scan.
5. Record the scripted three-minute demo and include the Convex dashboard proof.
6. Publish the required social post and submit before the repository-recorded deadline.
7. Conduct three customer interviews before claiming production adoption.

## Demo acceptance

The three-minute flow must show one coherent causal chain:

`supplier email -> extracted claim -> authoritative evidence -> deterministic plan -> human approval -> changed evidence -> frozen plan -> approved recovery`

The demo fails acceptance if any provider result is represented as live when it is a fixture, if a supplier claim is shown as independently verified, or if an outbound message is claimed before provider confirmation.

## Production follow-ups

- Replace anonymous judge auth with OAuth or passkeys and explicit organization roles.
- Add supplier import, minimum order quantity, case size, freight, currency, lot, and substitution policy.
- Add supplier acknowledgment, shipment, receiving, and partial-delivery reconciliation.
- Add retention controls for raw email and evidence files.
- Add an expiring, access-controlled decision-packet share link if customers validate the need.
- Combine per-need plans into one cross-need allocation with partial-basket supplier quotes.
- Extract quote text from PDF attachments into the same evidence-span extraction path.
