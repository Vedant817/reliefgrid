# ReliefGrid

ReliefGrid turns real supplier quote emails into a human-approved sourcing decision. It stores requests and supplier threads in Convex, ingests signed AgentMail replies, extracts offer fields with a configured LLM, checks external evidence through Firecrawl, and applies deterministic allocation rules.

The repository has no production-reachable sample loader, supplier seed mutation, synthetic offer workflow, or provider mock fallback. A new workspace starts empty and provider failures remain visible.

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
- Supplier claims and uploaded files do not become authoritative verification automatically.
- Allocation is deterministic; a person must approve the plan.

The current authentication is anonymous and browser-scoped. Organization login, roles, retention policy, backups, monitoring, and customer-specific approval rules remain production rollout requirements.
