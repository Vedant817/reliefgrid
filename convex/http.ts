import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { auth } from "./auth.js";
import { getAgentMail } from "./agentmailClient.js";
import { internal } from "./_generated/api";

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
  path: "/demo-bulletin",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const bulletinId = new URL(request.url).searchParams.get("id");
    if (!bulletinId) return new Response("Not found", { status: 404 });
    const bulletin: any = await ctx.runQuery(internal.evidenceDrift.getBulletin, { bulletinId: bulletinId as any });
    if (!bulletin) return new Response("Not found", { status: 404 });
    const html = `<!doctype html><html><head><title>${bulletin.title}</title></head><body><main><h1>${bulletin.title}</h1><strong>${bulletin.state}</strong><p>${bulletin.body}</p><time>${new Date(bulletin.updatedAt).toISOString()}</time></main></body></html>`;
    return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  }),
});

http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () => {
    return new Response(JSON.stringify({ ok: true, service: "reliefgrid" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }),
});

export default http;
