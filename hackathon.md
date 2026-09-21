# Hackathon log

- Project: ReliefGrid
- Event: Convex All Gas Hackathon
- What it does: Turns supplier quote emails into a human-approved, evidence-backed sourcing decision.
- Live app: Not deployed to a public frontend URL.
- Repository: https://github.com/Vedant817/reliefgrid
- Convex development deployment: `judicious-rat-761`
- Components: `@convex-dev/rate-limiter`, `@convex-dev/aggregate`
- Sponsor integrations: AgentMail for supplier mail and signed inbound webhooks; Firecrawl for supplier and evidence research; OpenAI for primary structured extraction.
- Convex features: schema and indexes, queries, mutations, Node actions, HTTP actions, Convex Auth, realtime subscriptions, file storage, scheduling, cron jobs, full-text search, pagination, aggregates, and rate limiting.
- Authentication: Convex Auth email and password.
- AI models configured in code: OpenAI `gpt-4o-mini`; Groq `openai/gpt-oss-120b` fallback.
- Started: 2026-09-02T17:08:10Z
- Last updated: 2026-09-20T17:17:09Z

## Build log

### 2026-09-02 — Foundation

- Initialized the Vite, React, Tailwind, and Convex application.
- Added the procurement data model, indexes, audit chain, supplier threads, versioned offers, evidence checks, and deterministic allocator.

### 2026-09-03 to 2026-09-05 — Live provider and safety paths

- Replaced provider mocks with visible failure behavior.
- Added AgentMail RFQ sending and signed webhook ingestion.
- Added Firecrawl evidence checks, model extraction, clarification drafts, plan invalidation, counterfactuals, and decision replay.
- Added approval guards, rate limits, aggregates, storage, full-text search, scheduling, cron processing, and authenticated ownership checks.

### 2026-09-05 to 2026-09-07 — End-to-end procurement workflow

- Added per-requirement inboxes, verified reply-to-offer ingestion, recall watch, supplier discovery, reminders, basket rollups, PDF quote extraction, and printable decision reports.
- Consolidated provider sends behind idempotency guards and kept allocation decisions deterministic and human-approved.

### 2026-09-20 — Production-oriented rebuild

- Removed production-reachable sample, seed, synthetic-offer, and provider-fallback paths.
- Replaced anonymous sessions with Convex Auth email/password accounts.
- Rebuilt the frontend as a guided Requirement, Suppliers, Quotes, Decide workflow.
- Made OpenAI the primary extraction provider with Groq fallback and added Exa fallback when Firecrawl cannot complete web research.

### 2026-09-20 — Production bug repair and browser verification

- Fixed optional certification scoring so a quote is not penalized when the requirement has no certification constraint.
- Moved new workspace ownership to the stable Convex Auth user ID while retaining bounded access to records written under older session identifiers.
- Converted supplier mutation failures into short field-level messages instead of rendering Convex transport and stack details.
- Routed approval through an action that awaits award-notice dispatch and reports sent, skipped, and failed counts; retained an idempotent delayed retry for the mutation/action crash window.
- Verified in a headed browser against the development deployment: empty-account onboarding, requirement creation, invalid supplier validation, safe supplier creation without sending, live quote extraction, 99 percent confidence for a no-certification quote, complete deterministic allocation, approval, sign-out/sign-in restoration, requirement search, and a 390 by 844 mobile viewport.
- Ran a controlled AgentMail loop using the application's shared development inbox. AgentMail accepted both the award and decline notices, and their durable `awardNotices` records reached `sent`.
- Verification passed: 17 test files and 148 tests, TypeScript typecheck, ESLint, and production build.
- Receipt in a distinct external supplier mailbox remains unproven; the delivery check stopped at AgentMail provider acceptance and durable sent-state using the application's own inbox.

## Submission status

- Public `convex.site` or `chatgpt.site` app: pending.
- Demo video under three minutes: pending; historical demo footage was removed during the production-oriented rebuild.
- Social post and submission through `vibeapps.dev`: not verified from repository evidence.
- Production rollout items still called out by the project: organization roles, SSO, retention policy, backups, monitoring, and customer-specific approval policies.
