import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPdfAttachmentBytes } from "./agentmail";
import {
  MAX_COMBINED_CHARS,
  MAX_PDF_ATTACHMENTS,
  PDF_TEXT_BUDGET_CHARS,
  combineBodyAndAttachments,
  extractPdfTextFromBytes,
  isPdfAttachment,
  labelAttachmentText,
  sanitizeAttachmentFilename,
  selectPdfAttachments,
  truncatePdfText,
} from "./pdfQuotes";

afterEach(() => vi.unstubAllGlobals());

// Minimal valid one-page PDF (~600 bytes) with a single known text line.
// Byte offsets for the xref table are computed so the file stays valid;
// the template itself is hand-written inline (no fixture files, no mocks
// of our own modules).
function buildMinimalPdfBytes(line: string): Uint8Array {
  const esc = line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const objs: string[] = [];
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
  objs[3] =
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>";
  const stream = `BT /F1 24 Tf 100 700 Td (${esc}) Tj ET`;
  objs[4] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  objs[5] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let i = 1; i <= 5; i++) {
    offsets[i] = pdf.length;
    pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefPos = pdf.length;
  pdf += "xref\n0 6\n0000000000 65535 f \n";
  for (let i = 1; i <= 5; i++) pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

describe("truncatePdfText", () => {
  it.each([
    ["short", "short"],
    ["", ""],
    ["x".repeat(10), "x".repeat(10)],
  ])("leaves %j unchanged", (input, expected) => {
    expect(truncatePdfText(input)).toBe(expected);
  });

  it(`truncates to the ${PDF_TEXT_BUDGET_CHARS}-char budget by default`, () => {
    const long = "a".repeat(PDF_TEXT_BUDGET_CHARS + 500);
    const out = truncatePdfText(long);
    expect(out).toHaveLength(PDF_TEXT_BUDGET_CHARS);
    expect(out).toBe(long.slice(0, PDF_TEXT_BUDGET_CHARS));
  });

  it("keeps exactly-at-budget text whole", () => {
    expect(truncatePdfText("b".repeat(PDF_TEXT_BUDGET_CHARS))).toHaveLength(PDF_TEXT_BUDGET_CHARS);
  });

  it("respects a custom budget", () => {
    expect(truncatePdfText("abcdef", 3)).toBe("abc");
  });

  it("returns empty for a non-positive budget", () => {
    expect(truncatePdfText("abc", 0)).toBe("");
  });
});

describe("sanitizeAttachmentFilename", () => {
  it.each([
    ["quote.pdf", "quote.pdf"],
    ["  spaced name.PDF  ", "spaced name.PDF"],
    ["evil\nname.pdf", "evil_name.pdf"],
    ["a\rb\nc.pdf", "a_b_c.pdf"],
    ["", "attachment.pdf"],
    ["   ", "attachment.pdf"],
    [null, "attachment.pdf"],
    [undefined, "attachment.pdf"],
    [42, "attachment.pdf"],
  ])("sanitizes %j to %j", (input, expected) => {
    expect(sanitizeAttachmentFilename(input)).toBe(expected);
  });

  it("caps at 200 chars", () => {
    expect(sanitizeAttachmentFilename(`${"n".repeat(300)}.pdf`)).toHaveLength(200);
  });
});

describe("labelAttachmentText", () => {
  it("labels as [attachment: <filename>] newline text", () => {
    expect(labelAttachmentText("quote.pdf", "100 filters $10")).toBe("[attachment: quote.pdf]\n100 filters $10");
  });

  it("sanitizes hostile filenames so labels cannot be forged across lines", () => {
    expect(labelAttachmentText("a\n[attachment: fake.pdf]\nb.pdf", "real")).toBe(
      "[attachment: a_[attachment: fake.pdf]_b.pdf]\nreal",
    );
  });

  it("preserves multiline extraction text verbatim", () => {
    expect(labelAttachmentText("q.pdf", "line1\nline2")).toBe("[attachment: q.pdf]\nline1\nline2");
  });
});

describe("isPdfAttachment", () => {
  it.each([
    [{ filename: "quote.pdf" }, true],
    [{ filename: "QUOTE.PDF" }, true],
    [{ filename: "  quote.Pdf  " }, true],
    [{ filename: "quote.png" }, false],
    [{ filename: "quote.pdf.txt" }, false],
    [{ content_type: "application/pdf" }, true],
    [{ contentType: "application/pdf" }, true],
    [{ content_type: "Application/PDF; charset=binary" }, true],
    [{ content_type: "image/png" }, false],
    [{ filename: "quote.pdf", content_type: "image/png" }, true],
    [{ filename: "scan.png", content_type: "application/pdf" }, true],
    [{}, false],
    [null, false],
    ["quote.pdf", false],
    [{ filename: 42 }, false],
  ])("classifies %j as pdf=%j", (input, expected) => {
    expect(isPdfAttachment(input)).toBe(expected);
  });
});

describe("selectPdfAttachments", () => {
  it("returns [] for missing or malformed lists", () => {
    expect(selectPdfAttachments(undefined)).toEqual([]);
    expect(selectPdfAttachments(null)).toEqual([]);
    expect(selectPdfAttachments("nope")).toEqual([]);
    expect(selectPdfAttachments({})).toEqual([]);
  });

  it("keeps PDFs and skips non-PDFs silently", () => {
    const out = selectPdfAttachments([
      { attachment_id: "a1", filename: "quote.pdf", content_type: "application/pdf", size: 100 },
      { attachment_id: "a2", filename: "photo.png", content_type: "image/png", size: 200 },
      { attachment_id: "a3", filename: "notes.txt", size: 50 },
    ]);
    expect(out).toEqual([
      { attachmentId: "a1", filename: "quote.pdf", contentType: "application/pdf", size: 100 },
    ]);
  });

  it(`caps at ${MAX_PDF_ATTACHMENTS} PDFs by default, preserving order`, () => {
    const list = [1, 2, 3, 4, 5].map((n) => ({ attachment_id: `a${n}`, filename: `q${n}.pdf` }));
    const out = selectPdfAttachments(list);
    expect(out.map((r) => r.attachmentId)).toEqual(["a1", "a2", "a3"]);
  });

  it("respects a custom max", () => {
    const list = [1, 2, 3].map((n) => ({ attachment_id: `a${n}`, filename: `q${n}.pdf` }));
    expect(selectPdfAttachments(list, 1)).toHaveLength(1);
  });

  it("drops entries without a usable id and accepts camelCase shapes", () => {
    const out = selectPdfAttachments([
      { filename: "orphan.pdf" },
      { attachment_id: "", filename: "empty.pdf" },
      { attachmentId: "c1", filename: "camel.pdf", contentType: "application/pdf" },
    ]);
    expect(out).toEqual([{ attachmentId: "c1", filename: "camel.pdf", contentType: "application/pdf", size: undefined }]);
  });
});

describe("combineBodyAndAttachments", () => {
  it("puts the body first so its evidence offsets are unchanged", () => {
    const combined = combineBodyAndAttachments("Body 10 filters.", ["[attachment: q.pdf]\nPDF 42 filters."]);
    expect(combined.startsWith("Body 10 filters.")).toBe(true);
    expect(combined).toBe("Body 10 filters.\n\n[attachment: q.pdf]\nPDF 42 filters.");
    expect(combined.indexOf("PDF 42 filters.")).toBeGreaterThan("Body 10 filters.".length);
  });

  it("keeps arrival order across several attachments", () => {
    const combined = combineBodyAndAttachments("B", ["[attachment: a.pdf]\nA", "[attachment: b.pdf]\nC"]);
    expect(combined).toBe("B\n\n[attachment: a.pdf]\nA\n\n[attachment: b.pdf]\nC");
  });

  it("leaves the body untouched when there are no attachments", () => {
    expect(combineBodyAndAttachments("only body", [])).toBe("only body");
  });

  it("handles an empty body by joining attachments only", () => {
    expect(combineBodyAndAttachments("", ["[attachment: a.pdf]\nA"])).toBe("[attachment: a.pdf]\nA");
  });

  it(`caps the result at ${MAX_COMBINED_CHARS} chars to match the extraction entry guard`, () => {
    expect(MAX_COMBINED_CHARS).toBe(100_000);
    const big = "x".repeat(60_000);
    const combined = combineBodyAndAttachments(big, [`[attachment: a.pdf]\n${"y".repeat(60_000)}`]);
    expect(combined).toHaveLength(100_000);
    expect(combined.startsWith(big)).toBe(true);
  });
});

describe("extractPdfTextFromBytes (real unpdf)", () => {
  it("extracts the known line from a tiny hand-crafted PDF", async () => {
    const bytes = buildMinimalPdfBytes("QUOTE 42 FILTERS 9 DOLLARS NSF");
    expect(bytes.length).toBeLessThan(2000);
    const text = await extractPdfTextFromBytes(bytes);
    expect(text).toContain("QUOTE 42 FILTERS 9 DOLLARS NSF");
  });

  it("feeds the labeled pipeline so offsets stay truthful", async () => {
    const bytes = buildMinimalPdfBytes("QUOTE 42 FILTERS 9 DOLLARS NSF");
    const body = "Body offers 10 filters.";
    const extracted = await extractPdfTextFromBytes(bytes);
    const combined = combineBodyAndAttachments(body, [labelAttachmentText("quote.pdf", truncatePdfText(extracted))]);
    expect(combined.startsWith(body)).toBe(true);
    expect(combined).toContain("[attachment: quote.pdf]");
    expect(combined).toContain("QUOTE 42 FILTERS 9 DOLLARS NSF");
  });

  it("returns empty for empty input without throwing", async () => {
    await expect(extractPdfTextFromBytes(new Uint8Array(0))).resolves.toBe("");
  });

  it("throws on corrupt input so callers can skip that attachment", async () => {
    await expect(extractPdfTextFromBytes(new TextEncoder().encode("not a pdf at all"))).rejects.toThrow();
  });
});

describe("fetchPdfAttachmentBytes (AgentMail download, fetch stubbed)", () => {
  it("GETs metadata then the presigned URL without leaking the key", async () => {
    const pdfBytes = buildMinimalPdfBytes("QUOTE 42 FILTERS 9 DOLLARS NSF");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            attachment_id: "att-1",
            size: pdfBytes.length,
            download_url: "https://storage.example.test/dl/att-1",
            expires_at: "2026-09-08T00:00:00Z",
            filename: "quote.pdf",
            content_type: "application/pdf",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(pdfBytes.buffer as ArrayBuffer, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const out = await fetchPdfAttachmentBytes(
      { apiKey: "test-key", inboxId: "inbox-1" },
      "inbox-1",
      "msg-1",
      "att-1",
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [metaUrl, metaInit] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(metaUrl).toBe("https://api.agentmail.to/v0/inboxes/inbox-1/messages/msg-1/attachments/att-1");
    expect(metaInit.headers.Authorization).toBe("Bearer test-key");
    const [dlUrl, dlInit] = fetchMock.mock.calls[1] as [string, RequestInit & { headers?: Record<string, string> }];
    expect(dlUrl).toBe("https://storage.example.test/dl/att-1");
    expect(dlInit?.headers?.Authorization).toBeUndefined();
    expect(out.filename).toBe("quote.pdf");
    expect(new Uint8Array(out.bytes).length).toBe(pdfBytes.length);
  });

  it("throws when metadata is missing the download URL", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ size: 1 }), { status: 200 })));
    await expect(
      fetchPdfAttachmentBytes({ apiKey: "k", inboxId: "i" }, "i", "m", "a"),
    ).rejects.toThrow(/download_url/);
  });

  it("rejects oversize attachments before downloading bytes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({ download_url: "https://storage.example.test/dl/big", size: 11 * 1024 * 1024 }),
          { status: 200 },
        ),
      ),
    );
    await expect(fetchPdfAttachmentBytes({ apiKey: "k", inboxId: "i" }, "i", "m", "a")).rejects.toThrow(/10MB/);
  });
});
