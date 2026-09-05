import { components, internal } from "./_generated/api";
import { AgentMail } from "@agentmail/convex";

declare const process: { env: Record<string, string | undefined> };

// Single configured AgentMail component handle. The webhook secret is passed
// explicitly because component functions are isolated from app env vars;
// onMessageReceived routes verified inbound mail into our reply loop.
export function getAgentMail(): AgentMail {
  return new AgentMail(components.agentmail, {
    webhookSecret: process.env.AGENTMAIL_WEBHOOK_SECRET,
    onMessageReceived: internal.email.onInboundReply,
  });
}
