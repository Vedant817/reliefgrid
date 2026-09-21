declare const process: { env: Record<string, string | undefined> };

export type LlmKind = "groq" | "openai" | "unconfigured";

export type LlmConfig = {
  kind: Exclude<LlmKind, "unconfigured">;
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type LlmResolution = LlmConfig | { kind: "unconfigured"; baseUrl: null; apiKey: null; model: string };

export type LlmFailure = { provider: Exclude<LlmKind, "unconfigured">; error: string };

export class LlmProviderError extends Error {
  constructor(public readonly failures: LlmFailure[]) {
    super(failures.length
      ? `LLM providers failed: ${failures.map((failure) => `${failure.provider}: ${failure.error}`).join("; ")}`
      : "no LLM key configured (OPENAI_API_KEY or GROQ_API_KEY)");
    this.name = "LlmProviderError";
  }
}

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

function openaiConfig(env: Record<string, string | undefined>): LlmConfig | null {
  if (!env.OPENAI_API_KEY) return null;
  return {
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL ?? "gpt-4o-mini",
  };
}

function groqConfig(env: Record<string, string | undefined>): LlmConfig | null {
  if (!env.GROQ_API_KEY) return null;
  return {
    kind: "groq",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKey: env.GROQ_API_KEY,
    model: env.GROQ_MODEL ?? "openai/gpt-oss-120b",
  };
}

// OpenAI is the primary extraction lane. Groq (GPT-OSS) is a live fallback
// when OpenAI is missing or the request fails. Callers never fabricate offers.
export function listLlmProviders(env: Record<string, string | undefined> = process.env): LlmConfig[] {
  return [openaiConfig(env), groqConfig(env)].filter((config): config is LlmConfig => config !== null);
}

export function resolveLlmProvider(env: Record<string, string | undefined> = process.env): LlmResolution {
  return listLlmProviders(env)[0] ?? { kind: "unconfigured", baseUrl: null, apiKey: null, model: "" };
}

export async function withLlmFallback<T>(args: {
  providers: LlmConfig[];
  run: (config: LlmConfig) => Promise<T>;
}): Promise<{ value: T; provider: LlmConfig; failures: LlmFailure[] }> {
  if (!args.providers.length) throw new LlmProviderError([]);
  const failures: LlmFailure[] = [];
  for (const provider of args.providers) {
    try {
      const value = await args.run(provider);
      return { value, provider, failures };
    } catch (error) {
      failures.push({ provider: provider.kind, error: error instanceof Error ? error.message : "unknown provider error" });
    }
  }
  throw new LlmProviderError(failures);
}

export function buildExtractionPrompt(
  rawBody: string,
  referenceTimeIso = new Date().toISOString(),
  timeZone = "UTC",
): { system: string; user: string } {
  const system = [
    "You extract structured supplier-offer fields from a procurement email.",
    "Reply with JSON only, no markdown, matching this schema:",
    '{"qty": number|null, "unitPriceCents": number|null, "arrivalAtIso": string|null,',
    ' "certStatus": "verified"|"unverified"|"needs_review", "language": "en"|"es", "conditions": string[], "confidence": 0..1,',
    ' "fieldConfidences": {"qty": 0..1, "price": 0..1, "arrival": 0..1, "cert": 0..1}}',
    "Use null for any value the email does not state clearly. Never guess quantities or prices.",
    `Resolve relative delivery phrases against email receipt time ${referenceTimeIso} in the requirement timezone ${timeZone}.`,
    "When the supplier states a calendar date but no time, return YYYY-MM-DD; the application treats it as end-of-day in the requirement timezone.",
    "When a time is stated, return an ISO-8601 timestamp with an explicit offset. Return null only when no usable delivery date is stated.",
    "certStatus is verified only when the email names a specific certification, standard, or registry. A generic claim that goods are certified is needs_review.",
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
    const parsed: unknown = JSON.parse(cleaned.slice(cleaned.indexOf("{")));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const raw = parsed as Record<string, unknown>;
    const fc = raw.fieldConfidences;
    const validNullableNumber = (value: unknown) => value === null || (typeof value === "number" && Number.isFinite(value));
    const validNullableString = (value: unknown) => value === null || typeof value === "string";
    if (
      !validNullableNumber(raw.qty)
      || !validNullableNumber(raw.unitPriceCents)
      || !validNullableString(raw.arrivalAtIso)
      || !["verified", "unverified", "needs_review"].includes(String(raw.certStatus))
      || !["en", "es"].includes(String(raw.language))
      || !Array.isArray(raw.conditions)
      || raw.conditions.some((condition) => typeof condition !== "string")
      || typeof raw.confidence !== "number"
      || !Number.isFinite(raw.confidence)
      || !fc
      || typeof fc !== "object"
      || Array.isArray(fc)
      || ["qty", "price", "arrival", "cert"].some((field) => {
        const value = (fc as Record<string, unknown>)[field];
        return typeof value !== "number" || !Number.isFinite(value);
      })
    ) return null;
    const arrivalValue = typeof raw.arrivalAtIso === "string" ? raw.arrivalAtIso.trim() : "";
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(arrivalValue);
    const hasExplicitOffset = /T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(arrivalValue);
    const arrivalAtIso = (isDateOnly || hasExplicitOffset) && Number.isFinite(Date.parse(arrivalValue))
      ? arrivalValue
      : null;
    const certStatus = raw.certStatus as ExtractedOffer["certStatus"];
    const language = raw.language as ExtractedOffer["language"];
    const qty = typeof raw.qty === "number" && raw.qty > 0 ? Math.floor(raw.qty) : null;
    const unitPriceCents =
      typeof raw.unitPriceCents === "number" && raw.unitPriceCents > 0 ? Math.round(raw.unitPriceCents) : null;
    const fieldConfidences = fc as Record<string, number>;
    return {
      qty,
      unitPriceCents,
      arrivalAtIso,
      certStatus,
      language,
      conditions: raw.conditions as string[],
      confidence: clamp01(raw.confidence),
      fieldConfidences: {
        qty: clamp01(fieldConfidences.qty),
        price: clamp01(fieldConfidences.price),
        arrival: clamp01(fieldConfidences.arrival),
        cert: clamp01(fieldConfidences.cert),
      },
    };
  } catch {
    return null;
  }
}

export async function withExtractionFallback(args: {
  providers: LlmConfig[];
  run: (config: LlmConfig) => Promise<{ requestId: string; content: string; latencyMs: number }>;
  retry?: (config: LlmConfig) => Promise<{ requestId: string; content: string; latencyMs: number } | null>;
}) {
  return await withLlmFallback({
    providers: args.providers,
    run: async (config) => {
      const response = await args.run(config);
      const offer = parseExtractionJson(response.content);
      if (offer) return { ...response, offer };

      const retryResponse = await args.retry?.(config);
      if (retryResponse) {
        const retryOffer = parseExtractionJson(retryResponse.content);
        if (retryOffer) return { ...retryResponse, offer: retryOffer };
      }

      throw new Error("unparseable model output");
    },
  });
}

export async function chatExtractedOfferWithFallback(
  prompt: { system: string; user: string },
  timeoutMs = 20000,
  env: Record<string, string | undefined> = process.env,
) {
  const result = await withExtractionFallback({
    providers: listLlmProviders(env),
    run: (config) => chatJson(config, prompt, timeoutMs, true),
    retry: (config) => config.kind === "groq"
      ? chatJson(config, {
          system: `${prompt.system} Your previous response failed strict validation. Return one JSON object containing every required field with exactly the documented types.`,
          user: prompt.user,
        }, timeoutMs, true)
      : Promise.resolve(null),
  });
  return {
    ...result.value,
    provider: result.provider.kind,
    model: result.provider.model,
    failures: result.failures,
  };
}

export async function chatJsonWithFallback(
  prompt: { system: string; user: string },
  timeoutMs = 20000,
  jsonMode = true,
  env: Record<string, string | undefined> = process.env,
): Promise<{ requestId: string; content: string; latencyMs: number; provider: Exclude<LlmKind, "unconfigured">; model: string; failures: LlmFailure[] }> {
  const result = await withLlmFallback({
    providers: listLlmProviders(env),
    run: (config) => chatJson(config, prompt, timeoutMs, jsonMode),
  });
  return {
    ...result.value,
    provider: result.provider.kind,
    model: result.provider.model,
    failures: result.failures,
  };
}

// Minimal OpenAI-compatible chat call (OpenAI and Groq share this shape).
// Returns the provider request id plus raw content. Throws on HTTP errors.
export async function chatJson(
  config: LlmConfig,
  prompt: { system: string; user: string },
  timeoutMs = 20000,
  jsonMode = true,
): Promise<{ requestId: string; content: string; latencyMs: number }> {
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
