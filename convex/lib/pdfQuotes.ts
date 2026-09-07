// Pure helpers for inbound PDF supplier-quote extraction.
//
// No Convex imports: this module stays unit-testable under Vitest and
// bundleable in both the default Convex runtime (V8 isolate, used by
// convex/email.ts) and Node actions ("use node"). The only third-party
// import is `unpdf`, whose serverless PDF.js build is zero-dependency ESM
// with DOMMatrix polyfills for non-browser runtimes.
import { extractText, getDocumentProxy } from "unpdf";

// Per-PDF text budget: 20_000 chars. A supplier quote rarely needs more;
// three maxed-out PDFs (60k) plus body still sit comfortably under the
// 100k combined cap while bounding LLM prompt cost and evidence offsets.
export const PDF_TEXT_BUDGET_CHARS = 20_000;
// Inbound fan-in bound: at most 3 PDFs per email are downloaded/parsed.
// More would risk blowing mutation time and transaction budgets.
export const MAX_PDF_ATTACHMENTS = 3;
// Combined body+attachments cap: 100_000 chars. MUST match the
// `rawBody.length > 100_000` guard in convex/actions/extract.ts so the
// enriched body the inbound hook forwards never trips entry validation.
export const MAX_COMBINED_CHARS = 100_000;
// Per-file download bound: 10MB, matching convex/attachments.ts.
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

export type PdfAttachmentRef = {
  attachmentId: string;
  filename?: string;
  contentType?: string;
  size?: number;
};

// True for PDF parts by filename (.pdf, any case) or MIME type
// (application/pdf, optional "; ..." suffix tolerated). Accepts both
// snake_case (AgentMail API) and camelCase shapes for robustness.
export function isPdfAttachment(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const rec = value as Record<string, unknown>;
  const filename = rec.filename ?? rec.name;
  if (typeof filename === "string" && filename.trim().toLowerCase().endsWith(".pdf")) return true;
  const contentType = rec.content_type ?? rec.contentType ?? rec.mimeType;
  if (typeof contentType === "string") {
    const base = contentType.split(";")[0]?.trim().toLowerCase();
    if (base === "application/pdf") return true;
  }
  return false;
}

// Pick up to `max` PDF attachments from a webhook message's `attachments`
// array, preserving arrival order. Skips non-PDFs silently and drops
// entries without a usable attachment id. Never throws on malformed input.
export function selectPdfAttachments(attachments: unknown, max: number = MAX_PDF_ATTACHMENTS): PdfAttachmentRef[] {
  if (!Array.isArray(attachments)) return [];
  const out: PdfAttachmentRef[] = [];
  for (const item of attachments) {
    if (out.length >= max) break;
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    const attachmentId = rec.attachment_id ?? rec.attachmentId ?? rec.id;
    if (typeof attachmentId !== "string" || !attachmentId) continue;
    if (!isPdfAttachment(item)) continue;
    const filename = rec.filename ?? rec.name;
    const contentType = rec.content_type ?? rec.contentType;
    out.push({
      attachmentId,
      filename: typeof filename === "string" ? filename : undefined,
      contentType: typeof contentType === "string" ? contentType : undefined,
      size: typeof rec.size === "number" ? rec.size : undefined,
    });
  }
  return out;
}

// Filenames land inside evidence text, so strip CR/LF (label injection)
// and cap length. Falls back to a stable placeholder, never empty.
export function sanitizeAttachmentFilename(name: unknown): string {
  if (typeof name !== "string") return "attachment.pdf";
  const cleaned = name.replace(/[\r\n]+/g, "_").trim().slice(0, 200);
  return cleaned || "attachment.pdf";
}

// Truncate extracted PDF text to the per-file char budget.
export function truncatePdfText(text: string, budget: number = PDF_TEXT_BUDGET_CHARS): string {
  if (budget <= 0) return "";
  return text.length > budget ? text.slice(0, budget) : text;
}

// Label each attachment's text so downstream evidence spans keep truthful
// offsets: the body occupies [0, body.length) unchanged and every labeled
// block follows with a deterministic prefix the span math can account for.
export function labelAttachmentText(filename: string, text: string): string {
  return `[attachment: ${sanitizeAttachmentFilename(filename)}]\n${text}`;
}

// Body first, then labeled attachments in arrival order, joined with blank
// lines and hard-capped so the result always satisfies the extraction
// entry guard. Body bytes are never reordered, preserving its spans.
export function combineBodyAndAttachments(
  body: string,
  labeledAttachments: string[],
  cap: number = MAX_COMBINED_CHARS,
): string {
  const parts = [body, ...labeledAttachments].filter((p) => p.length > 0);
  return parts.join("\n\n").slice(0, Math.max(0, cap));
}

// Real PDF-to-text via unpdf (serverless PDF.js). Takes raw bytes, returns
// the merged page text (possibly empty for scanned/image-only PDFs).
// Throws on corrupt input; callers treat that as skip-this-attachment.
export async function extractPdfTextFromBytes(data: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length === 0) return "";
  const pdf = await getDocumentProxy(bytes);
  try {
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : text;
  } finally {
    await pdf.loadingTask.destroy().catch(() => undefined);
  }
}
