# ReliefGrid

ReliefGrid turns real supplier quote emails into a human-approved sourcing decision. It stores requests and supplier threads in Convex, ingests signed AgentMail replies, extracts offer fields with OpenAI (Groq fallback), checks external evidence through Firecrawl (Exa fallback), and applies deterministic allocation rules.

Requirements, offers, evidence, and plans start empty, and provider failures remain visible. Each account receives four clearly labeled demo suppliers so a presenter can immediately exercise shortlisting, pasted-quote extraction, and allocation. Their reserved placeholder addresses can never receive RFQs or award notices; real outreach still requires a real supplier contact and an explicit user action.

## Local setup

```powershell
npm install
npx convex dev
```

In a second terminal:

```powershell
npm run dev
```

`npx convex dev` creates `.env.local` with `VITE_CONVEX_URL`. Backend provider credentials belong in the selected Convex deployment, not in the frontend environment. See [USER_GUIDE.md](USER_GUIDE.md) for provider setup, the complete user workflow, and production deployment instructions.

## Verification

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

## Safety boundaries

- Every operational record is scoped to the authenticated Convex identity.
- Supplier email is sent only after an explicit user action.
- Inbound email enters through the signed AgentMail webhook.
- Missing credentials and provider failures do not create fabricated offers or evidence.
- Offer extraction prefers OpenAI and automatically retries through Groq when OpenAI fails or has no key.
- Web research prefers Firecrawl and automatically retries through Exa when Firecrawl fails or has no credits.
- Supplier claims and uploaded files do not become authoritative verification automatically.
- Allocation is deterministic; a person must approve the plan.

Authentication is Convex Auth with email and password. Organization roles, retention policy, backups, monitoring, and customer-specific approval rules remain production rollout requirements.
