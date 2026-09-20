declare const process: { env: Record<string, string | undefined> };

export type LlmKind = "groq" | "openai" | "unconfigured";

export type LlmConfig = {
  kind: LlmKind;
  baseUrl: string | null;
  apiKey: string | null;
  model: string;
};

export type ExtractedOffer = {
  qty: number | null;
  unitPriceCents: number | null;
  arrivalAtIso: string | null;
  certStatus: "verified" | "unverified" | "needs_review";
  language: "en" | "es";
  conditions: string[];
  confidence: number;
  fieldConfidences: { qty: number; price: number; arrival: number; cert: number };
};

// Resolve the live LLM lane from deployment env. Groq is preferred because it
// is free and OpenAI-compatible; direct OpenAI works through the same path.
// Missing credentials are represented explicitly. Callers fail before a
// provider request and never fabricate an extraction.
export function resolveLlmProvider(env: Record<string, string | undefined> = process.env): LlmConfig {
  if (env.GROQ_API_KEY) {
    return {
      kind: "groq",
      baseUrl: "https://api.groq.com/openai/v1",
      apiKey: env.GROQ_API_KEY,
      model: env.GROQ_MODEL ?? "openai/gpt-oss-120b",
    };
  }
  if (env.OPENAI_API_KEY) {
    return {
      kind: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL ?? "gpt-4o-mini",
    };
  }
  return { kind: "unconfigured", baseUrl: null, apiKey: null, model: "" };
}

export function buildExtractionPrompt(rawBody: string, referenceTimeIso = new Date().toISOString()): { system: string; user: string } {
  const system = [
    "You extract structured supplier-offer fields from a relief-procurement email.",
    "Reply with JSON only, no markdown, matching this schema:",
    '{"qty": number|null, "unitPriceCents": number|null, "arrivalAtIso": string|null,',
    ' "certStatus": "verified"|"unverified"|"needs_review", "language": "en"|"es", "conditions": string[], "confidence": 0..1,',
    ' "fieldConfidences": {"qty": 0..1, "price": 0..1, "arrival": 0..1, "cert": 0..1}}',
    "Use null for any value the email does not state clearly. Never guess quantities or prices.",
    `Resolve relative delivery phrases against email receipt time ${referenceTimeIso}. Return an ISO-8601 timestamp with an explicit offset; return null when timezone or time is ambiguous.`,
    "certStatus is verified only when the email cites a certification such as NSF/ANSI 53.",
  ].join(" ");
  return { system, user: rawBody };
}

function clamp01(n: unknown, fallback = 0): number {
  return typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
}

// Parse and validate model JSON. Returns null when the output is unusable so
// the caller rejects the provider output instead of guessing values.
export function parseExtractionJson(text: string): ExtractedOffer | null {
  try {
    const cleaned = text.replace(/```json|```/g, "").trim();
    const raw = JSON.parse(cleaned.slice(cleaned.indexOf("{")));
    const arrivalAtIso = typeof raw.arrivalAtIso === "string" && Number.isFinite(Date.parse(raw.arrivalAtIso)) ? raw.arrivalAtIso : null;
    const certStatus =
      raw.certStatus === "verified" || raw.certStatus === "unverified" ? raw.certStatus : "needs_review";
    const language = raw.language === "es" ? "es" : "en";
    const qty = typeof raw.qty === "number" && raw.qty > 0 ? Math.floor(raw.qty) : null;
    const unitPriceCents =
      typeof raw.unitPriceCents === "number" && raw.unitPriceCents > 0 ? Math.round(raw.unitPriceCents) : null;
    const fc = raw.fieldConfidences ?? {};
    return {
      qty,
      unitPriceCents,
      arrivalAtIso,
      certStatus,
      language,
      conditions: Array.isArray(raw.conditions) ? raw.conditions.filter((c: unknown) => typeof c === "string") : [],
      confidence: clamp01(raw.confidence),
      fieldConfidences: {
        qty: clamp01(fc.qty),
        price: clamp01(fc.price),
        arrival: clamp01(fc.arrival),
        cert: clamp01(fc.cert),
      },
    };
  } catch {
    return null;
  }
}

// Minimal OpenAI-compatible chat call (Groq and OpenAI share this shape).
// Returns the provider request id plus raw content. Throws on HTTP errors.
export async function chatJson(
  config: LlmConfig,
  prompt: { system: string; user: string },
  timeoutMs = 20000,
  jsonMode = true,
): Promise<{ requestId: string; content: string; latencyMs: number }> {
  if (!config.baseUrl || !config.apiKey) throw new Error("no live LLM configured");
  const startedAt = Date.now();
  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      temperature: 0,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
  const body = (await res.json()) as { id?: string; choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content ?? "";
  if (!content) throw new Error("empty LLM response");
  return { requestId: body.id ?? "unknown", content, latencyMs: Date.now() - startedAt };
}
