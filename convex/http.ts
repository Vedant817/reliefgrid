import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { auth } from "./auth.js";
import { getAgentMail } from "./agentmailClient.js";

const http = httpRouter();

// Convex Auth OIDC discovery + JWKS (required for socket token verification).
auth.addHttpRoutes(http);

// AgentMail component webhook: Svix-verified, deduped inbound ingest that
// dispatches to email.onInboundReply (reply → extraction → offer version).
// Register https://<deployment>.convex.site/agentmail/webhook in the
// AgentMail console and set AGENTMAIL_WEBHOOK_SECRET on the deployment.
http.route({
  path: "/agentmail/webhook",
  method: "POST",
  // Cast: handleWebhook only uses ctx.runMutation, which action ctx provides;
  // the component's types demand a mutation ctx (fixed upstream).
  handler: httpAction(async (ctx, req) => getAgentMail().handleWebhook(ctx as any, req)),
});

http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () => {
    return new Response(JSON.stringify({ ok: true, service: "reliefgrid" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }),
});

export default http;
