# ReliefGrid

ReliefGrid watches the evidence behind urgent procurement decisions. It converts supplier email into comparable offers, proposes a deterministic human-approved plan, and freezes the plan when certification or recall evidence changes.

## Why it exists

Emergency procurement teams often coordinate time-critical purchases through scattered email threads. Comparing quantities, prices, deadlines, conditions, and certifications manually is slow; proving later why a supplier was selected is harder. ReliefGrid makes that decision chain explicit without allowing an LLM to spend money or decide eligibility by itself.

## Core flow

1. A coordinator records an incident and delivery requirement.
2. ReliefGrid creates a need-specific inbox and sends approved RFQs.
3. Signed AgentMail webhooks deliver supplier replies.
4. The LLM extracts fields with exact source spans; ambiguous values are quarantined.
5. Firecrawl checks authoritative evidence. Supplier claims alone remain unverified.
6. Deterministic code proposes the lowest-cost plan that satisfies deadline, budget, confidence, and certification constraints.
7. A human approves the complete plan; supplier notices are queued in the original threads.
8. If source evidence changes, Convex streams the invalidation and recovery state to every coordinator.

## Run locally

```bash
npm install
npx convex dev
npm run dev
```

Open `/` for the customer workflow or `/?demo=1` for the controlled judge flow.

## Verify

```bash
npm run lint
npm run typecheck
npm test -- --run
npm run build
npm run test:e2e
```

## Security model

- Operational access is rooted in the authenticated user's Convex `tokenIdentifier`.
- Child resources authorize through their incident rather than trusting client IDs.
- Provider callbacks enter only through the signed AgentMail component webhook.
- Raw supplier claims start as `needs_review`; source checks control eligibility.
- Synthetic demo contacts never receive outbound award messages.
- Billable actions are rate-limited and privileged write helpers are internal Convex functions.

## Deliberate limits

ReliefGrid is an urgent-sourcing decision layer, not a payment processor, route optimizer, autonomous buyer, or complete ERP. Production adoption still requires organization roles, customer-specific approval policy, supplier imports, fulfillment tracking, retention policy, and integrations with the buyer's system of record.

See `IMPLEMENTATION_PLAN.md` for release gates and `video/demo-script.md` for the judge sequence.
