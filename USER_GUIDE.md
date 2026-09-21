# ReliefGrid user guide

This guide describes the real application flow. Requirements, offers, evidence, and plans start empty. Each account includes four clearly labeled demo suppliers for shortlisting and pasted-quote demos; their reserved placeholder addresses cannot receive email.

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
   npx convex env set OPENAI_API_KEY
   npx convex env set GROQ_API_KEY
   npx convex env set FIRECRAWL_API_KEY
   npx convex env set EXA_API_KEY
   ```

   Extraction uses OpenAI first and falls back to Groq (`openai/gpt-oss-120b` by default) when OpenAI is missing or the request fails. Web research uses Firecrawl first and falls back to Exa. If a provider is not configured, the related action fails visibly; ReliefGrid does not substitute generated test data.

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

1. On first load, create an account with email and password (Convex Auth). Click **Create a requirement** or **New requirement**. The workspace is private to that account and includes its own starter directory of four demo suppliers.
2. Enter the requirement name and context.
3. For every line item, enter the real item name, quantity, and budget. Add more rows when one purchase contains several items.
4. Enter the required arrival time and delivery location. If certification matters, enter both the exact certification name and an exact model, product, or lot identifier used to match external evidence.
5. Click **Create requirement**. The requirement and its line items appear in the left column.
6. In **Shortlist**, begin with the **Saved vendor directory** or add a known supplier manually. If no saved vendor fits, expand **Search public sources (optional)**. Discovered contacts must show a source domain and public role mailbox; click **Confirm contact & shortlist** before outreach.
7. For a no-email demo, shortlist one of the clearly labeled demo suppliers, continue to **Quotes**, and click **Use sample quote**. The generated quote uses the requirement's actual quantity, deadline, budget, and certification policy, then runs through the live extraction path. Demo suppliers cannot receive RFQ or award email.
8. For real outreach, add or discover a supplier with a deliverable email, then click **Approve & send request**. This explicit approval creates or maps the request inbox and sends the request through AgentMail. For several line items, **Approve & send all** sends the selected real suppliers across all requests.
9. Wait for the supplier to reply, or paste a quote you already received. Inbound replies, pasted quotes, and sample quotes use the same live extraction path. Date-only delivery promises are treated as end-of-day in the requirement timezone; a missing delivery date is shown as **Arrival not confirmed**.
10. If an offer is ambiguous, click **Draft targeted clarification**, review the question, then click **Approve & send**. Nothing is sent merely because a draft was generated.
11. If certification is required, paste an authoritative HTTPS evidence page into **Independent certification check** and click **Verify**. The page must contain the exact certification and product/model identifier. Supporting or non-matching pages remain under review.
12. Optionally attach a supplier certificate or other evidence with **+ Cert evidence**. An attachment is supporting documentation; it does not by itself mark an offer verified.
13. Click **Compute recommendation**. Deterministic code applies quantity, price, deadline, budget, confidence, and evidence rules. Review the selected lines and rejection reasons.
14. Expand **Advanced** to inspect counterfactuals, recall checks, replay, and the technical decision trace without changing saved data.
15. When the recommendation has current, full coverage, click **Approve plan**. Approval stays disabled for zero-unit, incomplete, stale, or ambiguous results and revalidates current inputs before supplier notices are queued.
16. Use **View full report** in the decision summary to open the printable decision record, then choose **Print / PDF**.
17. Expand **Public recall check** when the product identifier should be checked against authoritative recall sources. A confirmed match invalidates affected offers, recomputes the plan, and creates a hold-notice draft. Review and explicitly approve that notice before sending it.

## 3. What each provider controls

| Provider | Required for | Behavior when unavailable |
| --- | --- | --- |
| Convex | authentication, database, realtime UI, storage, backend functions | application cannot start |
| AgentMail | request inboxes, RFQs, replies, reminders, clarifications, award/decline and hold notices | outbound/inbound email actions fail and remain unsent |
| OpenAI | primary offer extraction and clarification drafts | Groq is attempted before the operation fails |
| Groq | fallback LLM (`openai/gpt-oss-120b` unless `GROQ_MODEL` is set) | extraction and clarification fail |
| Firecrawl | primary supplier discovery, evidence verification, public recall checks | Exa is attempted before the operation fails |
| Exa | fallback web search and page contents | the operation fails without changing eligibility |

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
   npx convex env set --prod OPENAI_API_KEY
   npx convex env set --prod GROQ_API_KEY
   npx convex env set --prod FIRECRAWL_API_KEY
   npx convex env set --prod EXA_API_KEY
   ```

3. Register the production Convex site webhook in AgentMail. Do not reuse the development webhook URL or secret.
4. Deploy the production backend and build the frontend against its URL:

   ```powershell
   npx convex deploy --cmd "npm run build" --cmd-url-env-var-name VITE_CONVEX_URL
   ```

5. Publish the generated `dist` directory with your static host, or configure the host to run the same Convex deploy/build command using a production deploy key.
6. Open the deployed site and test with controlled real provider accounts: create one requirement, send one RFQ to an address you control, reply, verify ingestion, compute a plan, approve it, and confirm every outbound message.
7. Confirm the production Convex deployment contains no requirements, offers, evidence, or plans unless you intentionally imported real business data. The four labeled demo suppliers per account are expected starter records and cannot receive email.

## Production identity warning

The UI uses Convex Auth with email and password. Each account has a private workspace: operational records and its copies of the starter suppliers are not shared with other accounts. Organization roles (coordinator vs approver), SSO, retention policy, and customer-specific approval rules remain production rollout requirements.
