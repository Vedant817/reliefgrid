declare const process: { env: Record<string, string | undefined> };

export type AgentMailConfig = {
  apiKey: string | null;
  // Scoped keys are bound to one real inbox; per-need inboxes are mapped
  // onto it (see inboxes table) until an org key allows inbox creation.
  inboxId: string;
};

export function resolveAgentMail(env: Record<string, string | undefined> = process.env): AgentMailConfig {
  return {
    apiKey: env.AGENTMAIL_API_KEY ?? null,
    inboxId: env.AGENTMAIL_INBOX ?? "vedant817@agentmail.to",
  };
}

export function buildRfqEmail(need: { item: string; qty: number; deadlineAt: number; budgetCents: number; certRequired?: string }, supplierName: string): { subject: string; text: string } {
  const subject = `RFQ: ${need.qty}x ${need.item} (deadline ${new Date(need.deadlineAt).toISOString()})`;
  const text = [
    `Hello ${supplierName},`,
    ``,
    `ReliefGrid requests a quote for ${need.qty} units of ${need.item}.`,
    `Delivery deadline: ${new Date(need.deadlineAt).toISOString()}.`,
    `Budget ceiling: $${(need.budgetCents / 100).toFixed(2)}.`,
    need.certRequired ? `Certification required: ${need.certRequired}.` : ``,
    ``,
    `Reply with quantity, unit price, delivery time, and certification status.`,
    `This is a controlled demo RFQ; do not dispatch goods.`,
  ]
    .filter((line) => line !== `` || true)
    .join("\n");
  return { subject, text };
}

export async function sendAgentMailMessage(
  config: AgentMailConfig,
  to: string,
  subject: string,
  text: string,
  timeoutMs = 20000,
): Promise<{ messageId: string; threadId: string; latencyMs: number }> {
  if (!config.apiKey) throw new Error("no AgentMail key configured");
  const startedAt = Date.now();
  const res = await fetch(`https://api.agentmail.to/v0/inboxes/${encodeURIComponent(config.inboxId)}/messages/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to, subject, text }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`AgentMail HTTP ${res.status}`);
  const body = (await res.json()) as { message_id?: string; thread_id?: string };
  if (!body.message_id || !body.thread_id) throw new Error("AgentMail send missing ids");
  return { messageId: body.message_id, threadId: body.thread_id, latencyMs: Date.now() - startedAt };
}
