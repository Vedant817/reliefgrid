# ReliefGrid user guide

This guide describes the real application flow. A new workspace starts empty; the application does not load sample incidents, suppliers, offers, evidence, or plans.

## 1. Start the application locally

Prerequisites: Node.js 20 or newer, npm, and a Convex account.

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Start Convex in the first PowerShell window:

   ```powershell
   npx convex dev
   ```

   On first use, follow the Convex prompt to sign in and select or create the project. Convex writes the development deployment and `VITE_CONVEX_URL` to `.env.local`.

3. Configure the backend providers on the development deployment. Omit the value to enter each secret interactively instead of putting it in shell history:

   ```powershell
   npx convex env set AGENTMAIL_API_KEY
   npx convex env set AGENTMAIL_INBOX
   npx convex env set AGENTMAIL_WEBHOOK_SECRET
   npx convex env set FIRECRAWL_API_KEY
   npx convex env set GROQ_API_KEY
   ```

   `OPENAI_API_KEY` can replace `GROQ_API_KEY`. If a provider is not configured, the related action fails visibly; ReliefGrid does not substitute generated test data.

4. In AgentMail, register this webhook URL using the same webhook secret:

   ```text
   https://<your-convex-site>.convex.site/agentmail/webhook
   ```

   Find the site URL in the Convex dashboard. `AGENTMAIL_INBOX` is optional for an AgentMail account that is allowed to create per-request inboxes; otherwise set it to a real shared inbox ID.

5. Start the frontend in a second PowerShell window:

   ```powershell
   npm run dev
   ```

6. Open the URL printed by Vite, normally `http://localhost:5173`.

## 2. Use the application

1. On first load, ReliefGrid creates a private anonymous workspace in the browser. Click **Create your first requirement** or **New Incident**.
2. Enter the incident name and operational context.
3. For every line item, enter the real item name, quantity, and budget. Add more rows when one purchase contains several items.
4. Enter the required arrival time and delivery location. If certification matters, enter both the exact certification name and an exact model, product, or lot identifier used to match external evidence.
5. Click **Create requirement**. The incident and its requests appear in the left column.
6. Under **Supplier outreach**, click **Add supplier** and enter a real supplier name, deliverable email address, and service region. Addresses under special-use test/example domains are rejected.
7. Optionally click **Find suppliers** to search with Firecrawl. Search results only prefill a name; you must still provide and review the real contact email.
8. Click **Approve & send RFQ** for a supplier. This explicit approval creates or maps the request inbox and sends the RFQ through AgentMail. For several line items, **Approve & send all** sends the selected supplier list across all requests.
9. Wait for the supplier to reply to the RFQ email. The signed AgentMail webhook ingests the reply; the configured LLM extracts quantity, unit price, arrival time, conditions, and source spans. The offer matrix updates in real time.
10. If an offer is ambiguous, click **Draft targeted clarification**, review the question, then click **Approve & send**. Nothing is sent merely because a draft was generated.
11. If certification is required, paste an authoritative HTTPS evidence page into **Independent certification check** and click **Verify**. The page must contain the exact certification and product/model identifier. Supporting or non-matching pages remain under review.
12. Optionally attach a supplier certificate or other evidence with **+ Cert evidence**. An attachment is supporting documentation; it does not by itself mark an offer verified.
13. Click **Compute allocation**. Deterministic code applies quantity, price, deadline, budget, confidence, and evidence rules. Review the selected lines and rejection reasons.
14. Expand **How was this decision made?** to compare constraint changes without changing saved data.
15. When the recommendation is complete and correct, click **Approve plan**. Approval revalidates current inputs and queues award/decline notices in the original supplier threads.
16. Use **View full report** in the decision summary to open the printable decision record, then choose **Print / PDF**.
17. Use **Public recall watch** when the product identifier should be checked against authoritative recall sources. A confirmed match invalidates affected offers, recomputes the plan, and creates a hold-notice draft. Review and explicitly approve that notice before sending it.

## 3. What each provider controls

| Provider | Required for | Behavior when unavailable |
| --- | --- | --- |
| Convex | authentication, database, realtime UI, storage, backend functions | application cannot start |
| AgentMail | request inboxes, RFQs, replies, reminders, clarifications, award/decline and hold notices | outbound/inbound email actions fail and remain unsent |
| Groq or OpenAI | extracting offers and drafting clarifications | reply extraction and clarification drafting fail |
| Firecrawl | supplier discovery, evidence verification, public recall checks | those checks fail without changing eligibility |

## 4. Production deployment checklist

1. Run the release checks:

   ```powershell
   npm run lint
   npm run typecheck
   npm test
   npm run build
   npm run test:e2e
   ```

2. Set separate production secrets. Repeat for each required key:

   ```powershell
   npx convex env set --prod AGENTMAIL_API_KEY
   npx convex env set --prod AGENTMAIL_INBOX
   npx convex env set --prod AGENTMAIL_WEBHOOK_SECRET
   npx convex env set --prod FIRECRAWL_API_KEY
   npx convex env set --prod GROQ_API_KEY
   ```

3. Register the production Convex site webhook in AgentMail. Do not reuse the development webhook URL or secret.
4. Deploy the production backend and build the frontend against its URL:

   ```powershell
   npx convex deploy --cmd "npm run build" --cmd-url-env-var-name VITE_CONVEX_URL
   ```

5. Publish the generated `dist` directory with your static host, or configure the host to run the same Convex deploy/build command using a production deploy key.
6. Open the deployed site and test with controlled real provider accounts: create one requirement, send one RFQ to an address you control, reply, verify ingestion, compute a plan, approve it, and confirm every outbound message.
7. Confirm the production Convex deployment starts with no records unless you intentionally imported real business data.

## Production identity warning

The current UI automatically signs visitors into anonymous, browser-scoped Convex Auth workspaces. This isolates records, but it is not an organization login or role system. Before allowing multiple employees or external customers into a production URL, replace anonymous sign-in with your organization identity provider and define coordinator/approver roles. Do not describe this build as enterprise access-controlled until that work is complete.
