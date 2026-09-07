import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { fetchPdfAttachmentBytes, normalizeMailbox, resolveAgentMail } from "./lib/agentmail";
import {
  MAX_PDF_ATTACHMENTS,
  MAX_PDF_BYTES,
  combineBodyAndAttachments,
  extractPdfTextFromBytes,
  labelAttachmentText,
  selectPdfAttachments,
  truncatePdfText,
} from "./lib/pdfQuotes";
import { matchNeedsByKeywords } from "./lib/matchNeeds";
import { writeAudit } from "./lib/audit";

// Inbound reply handler, invoked by the component after Svix verification and
// event dedup. Links the reply thread back to our RFQ thread and schedules
// live extraction, closing the send → reply → offer loop.
export const onInboundReply = internalMutation({
  args: { message: v.any(), thread: v.any(), eventId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const threadId = args.thread?.thread_id ?? args.message?.thread_id;
    const refs: string[] = [
      ...(args.message?.in_reply_to ? [args.message.in_reply_to] : []),
      ...(args.thread?.references ?? []),
    ];
    let match = null;
    if (threadId) {
      match = await ctx.db
        .query("rfqThreads")
        .withIndex("by_agentmail_thread", (q) => q.eq("agentmailThreadId", threadId))
        .first();
    }
    if (!match && refs.length > 0) {
      for (const reference of refs) {
        match = await ctx.db
          .query("rfqThreads")
          .withIndex("by_agentmail_message", (q) => q.eq("agentmailMessageId", reference))
          .first();
        if (match) break;
      }
    }
    if (!match) return null;
    const bodyText = args.message?.text ?? args.message?.extracted_text ?? "";
    // --- INBOUND PDF QUOTE ATTACHMENTS: supplier quotes often arrive as PDF
    // attachments while extraction runs on body text only. For PDF parts (by
    // filename/content-type, max 3) download bytes via the AgentMail
    // attachments API, extract text with unpdf, and append labeled text to
    // the body used for extraction. Best-effort per attachment: any failure
    // is skipped so a PDF problem never breaks the body-text path. Non-PDF
    // parts are skipped silently. Work is bounded here (max 3 PDFs, 10MB and
    // 20k chars each); the 100k combined cap is enforced when combining to
    // match the extraction entry guard downstream. ---
    let text = bodyText;
    try {
      const rawAttachments = Array.isArray(args.message?.attachments) ? args.message.attachments : [];
      const pdfRefs = selectPdfAttachments(rawAttachments, MAX_PDF_ATTACHMENTS);
      if (pdfRefs.length > 0) {
        const config = resolveAgentMail();
        const inboxId =
          args.message?.inbox_id ?? args.message?.inboxId ?? args.thread?.inbox_id ?? config.inboxId;
        const messageId = args.message?.message_id ?? args.message?.messageId;
        if (config.apiKey && typeof inboxId === "string" && inboxId && typeof messageId === "string" && messageId) {
          const labeled: string[] = [];
          for (const ref of pdfRefs) {
            try {
              if (typeof ref.size === "number" && ref.size > MAX_PDF_BYTES) continue;
              const file = await fetchPdfAttachmentBytes(config, inboxId, messageId, ref.attachmentId);
              const rawText = await extractPdfTextFromBytes(file.bytes);
              const truncated = truncatePdfText(rawText);
              if (!truncated.trim()) continue;
              labeled.push(labelAttachmentText(file.filename ?? ref.filename ?? "attachment.pdf", truncated));
            } catch {
              continue;
            }
          }
          if (labeled.length > 0) text = combineBodyAndAttachments(bodyText, labeled);
        }
      }
    } catch {
      text = bodyText;
    }
    if (!text.trim()) return null;
    const sender = normalizeMailbox(args.message?.from ?? args.message?.sender);
    const supplier = await ctx.db.get(match.supplierId);
    if (!supplier || sender !== normalizeMailbox(supplier.contactEmail)) return null;
    if (match.status === "awarded" || match.status === "rejected") {
      const need = await ctx.db.get(match.needId);
      await ctx.db.patch(match._id, { lastReplyAt: Date.now() });
      await writeAudit(ctx, {
        entity: "rfqThreads",
        entityId: match._id,
        action: "supplier_acknowledgment_received",
        actor: "supplier",
        incidentId: need?.incidentId,
        meta: JSON.stringify({ messageId: args.message?.message_id ?? args.eventId, terminalStatus: match.status }),
      });
      return null;
    }
    await ctx.scheduler.runAfter(0, internal.actions.extract.extractOfferFromEmail, {
      needId: match.needId,
      supplierId: match.supplierId,
      rawBody: text,
      rawEmailId: `agentmail-${args.message?.message_id ?? args.eventId}`,
      receivedAt: args.message?.timestamp ? Date.parse(args.message.timestamp) : Date.now(),
    });
    // --- MULTI-NEED FAN-OUT (basket slice): one reply may quote several line
    // items, so also extract for sibling needs matched by keywords. Per-need
    // failures never break the primary path. ---
    try {
      const primaryNeed = await ctx.db.get(match.needId);
      if (primaryNeed) {
        const siblings = await ctx.db
          .query("needs")
          .withIndex("by_incident", (q) => q.eq("incidentId", primaryNeed.incidentId))
          .take(100);
        const candidates = siblings
          .filter((n) => String(n._id) !== String(match.needId))
          .map((n) => ({ _id: String(n._id), item: n.item }));
        const matchedIds = matchNeedsByKeywords(text, candidates).slice(0, 5);
        for (const siblingId of matchedIds) {
          try {
            await ctx.scheduler.runAfter(0, internal.actions.extract.extractOfferFromEmail, {
              needId: siblingId as any,
              supplierId: match.supplierId,
              rawBody: text,
              rawEmailId: `agentmail-${args.message?.message_id ?? args.eventId}`,
              receivedAt: args.message?.timestamp ? Date.parse(args.message.timestamp) : Date.now(),
            });
          } catch {
            continue;
          }
        }
      }
    } catch {
      // Fan-out is best-effort; the primary extraction above already succeeded.
    }
    await ctx.db.patch(match._id, { status: "replied", lastReplyAt: Date.now() });
    return null;
  },
});
