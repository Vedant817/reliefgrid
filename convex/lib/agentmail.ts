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
    inboxId: env.AGENTMAIL_INBOX ?? "",
  };
}

export function normalizeMailbox(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const angleAddress = value.match(/<([^<>]+)>/)?.[1];
  const address = (angleAddress ?? value).trim().toLowerCase();
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address) ? address : null;
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
  ].join("\n");
  return { subject, text };
}

export type AgentMailAttachmentMeta = {
  attachmentId: string;
  size: number;
  downloadUrl: string;
  expiresAt: string;
  filename?: string;
  contentType?: string;
};

// Resolve the short-lived download URL for one attachment.
// GET /v0/inboxes/{inbox_id}/messages/{message_id}/attachments/{attachment_id}
// → { attachment_id, size, download_url, expires_at, filename?, content_type? }
// Throws with the HTTP status only; keys and addresses are never logged here.
export async function getAgentMailAttachmentMeta(
  config: AgentMailConfig,
  inboxId: string,
  messageId: string,
  attachmentId: string,
  timeoutMs = 15000,
): Promise<AgentMailAttachmentMeta> {
  if (!config.apiKey) throw new Error("no AgentMail key configured");
  const res = await fetch(
    `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    },
  );
  if (!res.ok) {
    const detail = (await res.text()).replace(/\s+/g, " ").slice(0, 200);
    throw new Error(`AgentMail attachment HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  const body = (await res.json()) as {
    download_url?: unknown;
    size?: unknown;
    expires_at?: unknown;
    filename?: unknown;
    content_type?: unknown;
  };
  if (typeof body.download_url !== "string" || !body.download_url) {
    throw new Error("AgentMail attachment missing download_url");
  }
  return {
    attachmentId,
    size: typeof body.size === "number" ? body.size : 0,
    downloadUrl: body.download_url,
    expiresAt: typeof body.expires_at === "string" ? body.expires_at : "",
    filename: typeof body.filename === "string" ? body.filename : undefined,
    contentType: typeof body.content_type === "string" ? body.content_type : undefined,
  };
}

// Fetch raw bytes from a presigned `download_url`. No Authorization header:
// the URL itself is the capability, and the API key must not leak to the
// storage host. Rejects files over `maxBytes` (default 10MB).
export async function downloadAgentMailAttachmentBytes(
  downloadUrl: string,
  timeoutMs = 15000,
  maxBytes = 10 * 1024 * 1024,
): Promise<ArrayBuffer> {
  const res = await fetch(downloadUrl, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`Attachment download HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > maxBytes) throw new Error(`attachment over ${maxBytes} bytes rejected`);
  return buf;
}

// One call per PDF: metadata → presigned URL → bytes. Enforces the 10MB
// bound on both the advertised size and the actual payload.
export async function fetchPdfAttachmentBytes(
  config: AgentMailConfig,
  inboxId: string,
  messageId: string,
  attachmentId: string,
  timeoutMs = 15000,
): Promise<{ bytes: ArrayBuffer; filename?: string; contentType?: string; size: number }> {
  const meta = await getAgentMailAttachmentMeta(config, inboxId, messageId, attachmentId, timeoutMs);
  if (meta.size > 10 * 1024 * 1024) throw new Error("attachment over 10MB rejected");
  const bytes = await downloadAgentMailAttachmentBytes(meta.downloadUrl, timeoutMs);
  return { bytes, filename: meta.filename, contentType: meta.contentType, size: meta.size };
}

export async function createAgentMailInbox(
  config: AgentMailConfig,
  username: string,
  displayName: string,
  timeoutMs = 20000,
): Promise<{ inboxId: string; email: string; latencyMs: number }> {
  if (!config.apiKey) throw new Error("no AgentMail key configured");
  const startedAt = Date.now();
  const res = await fetch("https://api.agentmail.to/v0/inboxes", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ username, display_name: displayName, client_id: `inbox-${username}` }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = (await res.text()).replace(/\s+/g, " ").slice(0, 300);
    throw new Error(`AgentMail HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  const body = (await res.json()) as { inbox_id?: string; email?: string };
  if (!body.inbox_id || !body.email) throw new Error("AgentMail inbox creation missing ids");
  return { inboxId: body.inbox_id, email: body.email, latencyMs: Date.now() - startedAt };
}

export async function getAgentMailInbox(
  config: AgentMailConfig,
  timeoutMs = 20000,
): Promise<{ inboxId: string; email: string; latencyMs: number }> {
  if (!config.apiKey) throw new Error("no AgentMail key configured");
  if (!config.inboxId) throw new Error("no AgentMail shared inbox configured");
  const startedAt = Date.now();
  const res = await fetch(`https://api.agentmail.to/v0/inboxes/${encodeURIComponent(config.inboxId)}`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`AgentMail shared inbox HTTP ${res.status}`);
  const body = (await res.json()) as { inbox_id?: string; email?: string };
  if (!body.inbox_id || !body.email) throw new Error("AgentMail shared inbox lookup missing ids");
  return { inboxId: body.inbox_id, email: body.email, latencyMs: Date.now() - startedAt };
}

export async function sendAgentMailMessage(
  config: AgentMailConfig,
  to: string,
  subject: string,
  text: string,
  timeoutMs = 20000,
  fromInboxId?: string,
  dispatchKey?: string,
): Promise<{ messageId: string; threadId: string; latencyMs: number }> {
  if (!config.apiKey) throw new Error("no AgentMail key configured");
  const startedAt = Date.now();
  const sender = fromInboxId ?? config.inboxId;
  if (!sender) throw new Error("no AgentMail sender inbox configured");
  const res = await fetch(`https://api.agentmail.to/v0/inboxes/${encodeURIComponent(sender)}/messages/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      ...(dispatchKey ? { "Idempotency-Key": dispatchKey } : {}),
    },
    body: JSON.stringify({ to, subject, text, ...(dispatchKey ? { headers: { "X-ReliefGrid-Dispatch": dispatchKey } } : {}) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`AgentMail HTTP ${res.status}`);
  const body = (await res.json()) as { message_id?: string; thread_id?: string };
  if (!body.message_id || !body.thread_id) throw new Error("AgentMail send missing ids");
  return { messageId: body.message_id, threadId: body.thread_id, latencyMs: Date.now() - startedAt };
}

export async function replyAgentMailMessage(
  config: AgentMailConfig,
  inboxId: string,
  messageId: string,
  text: string,
  timeoutMs = 20000,
  dispatchKey?: string,
): Promise<{ messageId: string; threadId: string; latencyMs: number }> {
  if (!config.apiKey) throw new Error("no AgentMail key configured");
  const startedAt = Date.now();
  const res = await fetch(
    `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}/reply`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        ...(dispatchKey ? { "Idempotency-Key": dispatchKey } : {}),
      },
      body: JSON.stringify({ text, ...(dispatchKey ? { headers: { "X-ReliefGrid-Dispatch": dispatchKey } } : {}) }),
      signal: AbortSignal.timeout(timeoutMs),
    },
  );
  if (!res.ok) throw new Error(`AgentMail reply HTTP ${res.status}`);
  const body = (await res.json()) as { message_id?: string; thread_id?: string };
  if (!body.message_id || !body.thread_id) throw new Error("AgentMail reply response missing IDs");
  return { messageId: body.message_id, threadId: body.thread_id, latencyMs: Date.now() - startedAt };
}
