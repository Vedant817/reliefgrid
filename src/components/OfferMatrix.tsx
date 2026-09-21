import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { certificationLabel, formatCents, formatDate, humanizeStatus } from "../lib/format";
import { userFacingError } from "../lib/errors";
import { PasteQuote } from "./PasteQuote";

function EvidenceAttach({ offerId }: { offerId: any }) {
  const attachments: any = useQuery(api.attachments.listAttachmentsByOffer, { offerId }) ?? [];
  const generateUrl = useMutation(api.attachments.generateUploadUrl);
  const record = useMutation(api.attachments.recordAttachment);
  const remove = useMutation(api.attachments.removeAttachment);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const url = await generateUrl({ offerId });
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
      if (!res.ok) throw new Error("upload failed");
      const { storageId } = await res.json();
      await record({ offerId, storageId, name: file.name });
    } catch (cause) {
      setError(userFacingError(cause, "Could not upload evidence"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded-md border border-hairline bg-sheet px-2 py-1 text-[11px] font-medium text-soft hover:bg-paper">
          {busy ? "Uploading…" : "+ Cert evidence"}
          <input type="file" aria-label="Attach certification evidence" className="hidden" disabled={busy} onChange={(event) => {
            const input = event.currentTarget;
            void onFile(input.files?.[0]).finally(() => { input.value = ""; });
          }} />
        </label>
        {attachments.map((a: any) => (
          <span key={a._id} className="flex items-center gap-1 rounded-md border border-hairline bg-paper px-2 py-1 text-[11px] tabular-nums text-soft">
            <a href={a.url ?? undefined} target="_blank" rel="noreferrer" className="underline underline-offset-2">{a.name}</a>
            <button
              aria-label={`Remove ${a.name}`}
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError(null);
                void remove({ attachmentId: a._id })
                  .catch((cause) => setError(userFacingError(cause, "Could not remove evidence")))
                  .finally(() => setBusy(false));
              }}
              className="text-soft hover:text-ink disabled:opacity-40"
            >×</button>
          </span>
        ))}
      </div>
      {error && <div role="alert" className="mt-2 text-[11px] text-seal">{error}</div>}
    </div>
  );
}

function Badge({ children, tone }: any) {
  const map: any = {
    verified: "border-[#bfd9c9] bg-[#eaf2ed] text-ledger",
    late: "border-[#edc4b6] bg-[#f9ece7] text-seal",
    review: "border-[#e7d9ae] bg-[#fbf7ea] text-[#7a5c14]",
    neutral: "border-hairline bg-paper text-soft",
  };
  return <span className={`rounded-[4px] border px-2 py-0.5 text-[11px] font-semibold ${map[tone] ?? map.neutral}`}>{children}</span>;
}

export function OfferMatrix({ offers, coverage, certRequired, inboxEmail, needId, suppliers, need }: any) {
  const draftClarification = useAction(api.actions.clarify.draftClarification);
  const sendClarification = useAction(api.actions.clarify.approveAndSendClarification);
  const verifyOffer = useAction(api.actions.verify.verifyOffer);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const [sent, setSent] = useState<Record<string, boolean>>({});
  const [pendingOffer, setPendingOffer] = useState<string | null>(null);
  const [clarificationError, setClarificationError] = useState<Record<string, string>>({});
  const [verificationUrl, setVerificationUrl] = useState<Record<string, string>>({});
  const [verificationMessage, setVerificationMessage] = useState<Record<string, string>>({});

  if (!offers.length) {
    return (
      <div className="card p-6">
        <div className="text-sm font-semibold">Quotes</div>
        <div className="mt-1 text-sm text-soft">
          No quotes yet. Send a request, wait for a reply, or paste a quote you already received.
        </div>
        {inboxEmail && (
          <p className="mt-3 rounded-lg border border-hairline bg-paper px-3 py-2 text-xs tabular-nums text-soft">
            Request inbox: <span className="font-medium text-ink">{inboxEmail}</span>
          </p>
        )}
        <PasteQuote needId={needId} suppliers={suppliers ?? []} need={need} />
      </div>
    );
  }

  // Order and eligibility flags arrive precomputed from the workspace read
  // model, so every view ranks offers identically.
  const sorted = offers;

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-3">
        <div className="eyebrow">Quotes</div>
        <span className="flex items-center gap-2 text-xs tabular-nums text-soft">
          {offers.length} offers, {coverage?.totalQty ?? "?"} units quoted
        </span>
      </div>
      {inboxEmail ? (
        <p className="border-b border-hairline bg-paper px-4 py-2 text-xs tabular-nums text-soft">
          Request inbox: <span className="font-medium text-ink">{inboxEmail}</span>
        </p>
      ) : null}

      <div className="divide-y divide-hairline">
        {sorted.map((o: any) => {
          const { isLate, isVerified, ambiguous } = o;
          return (
            <div key={o._id} className="p-4 hover:bg-paper">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    {o.supplier?.name ?? "Unknown supplier"}
                    {o.language === "es" && <span className="rounded bg-ledger px-1.5 py-0.5 text-[11px] font-medium text-white">ES/EN</span>}
                  </div>
                  {!o.supplier?.isDemo && o.supplier?.contactEmail ? <div className="mt-0.5 text-xs tabular-nums text-soft">{o.supplier.contactEmail}</div> : null}
                </div>
                <div className="text-right">
                  <div className="font-bold tabular-nums">{formatCents(o.unitPriceCents)} <span className="text-xs font-normal text-soft">× {o.qty}</span></div>
                  <div className="text-xs tabular-nums text-soft">= {formatCents(o.qty * o.unitPriceCents)} total</div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {!certRequired
                  ? <Badge tone="neutral">{certificationLabel(certRequired)}</Badge>
                  : isVerified
                    ? <Badge tone="verified">{certRequired} verified</Badge>
                    : <Badge tone="review">{humanizeStatus(o.certStatus)}</Badge>}
                {!o.arrivalAt
                  ? <Badge tone="review">Arrival not confirmed</Badge>
                  : isLate
                    ? <Badge tone="late">Late — {formatDate(o.arrivalAt, need?.timezone)}</Badge>
                    : <Badge tone="neutral">{formatDate(o.arrivalAt, need?.timezone)}</Badge>}
                <Badge tone={o.confidence > 0.9 ? "verified" : "review"}>{(o.confidence * 100).toFixed(0)}% confidence</Badge>
                {o.conditions?.map((c: string, i: number) => (
                  <Badge key={i} tone="review">{c}</Badge>
                ))}
              </div>

              {o.fieldEvidence && (
                <div className="mt-2 flex flex-wrap gap-2 text-[10px] tabular-nums text-soft">
                  {Object.entries(o.fieldEvidence).map(([field, evidence]: [string, any]) => (
                    <span key={field} className={evidence.confidence < 0.75 ? "font-medium text-[#7a5c14]" : ""}>
                      {field} {Math.round(evidence.confidence * 100)}%
                    </span>
                  ))}
                </div>
              )}

              {ambiguous && (
                <div className="mt-3 rounded-lg border border-[#e7d9ae] bg-[#fbf7ea] p-3">
                  <div className="text-xs font-semibold text-[#5c4a10]">{o.arrivalAt ? "Quote details need confirmation" : "Delivery date needs confirmation"}</div>
                  {!drafts[o._id] ? (
                    <button
                      onClick={async () => {
                        setPendingOffer(o._id);
                        setClarificationError((current) => ({ ...current, [o._id]: "" }));
                        try {
                          const result = await draftClarification({ offerId: o._id });
                          setDrafts((current) => ({ ...current, [o._id]: result.question }));

                        } catch (cause) {
                          setClarificationError((current) => ({ ...current, [o._id]: userFacingError(cause, "Could not draft clarification") }));
                        } finally {
                          setPendingOffer(null);
                        }
                      }}
                      disabled={pendingOffer === o._id}
                      className="mt-2 rounded-lg bg-ledger px-3 py-1.5 text-xs font-medium text-white hover:bg-ledger-deep disabled:opacity-50"
                    >
                      {pendingOffer === o._id ? "Drafting…" : "Draft targeted clarification"}
                    </button>
                  ) : (
                    <div className="mt-2">
                      <p className="text-xs text-ink">{drafts[o._id]}</p>
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-[10px] text-soft">Drafted from the unresolved quote fields</span>
                        <button
                           disabled={sent[o._id] || pendingOffer === o._id}
                           onClick={async () => {
                             setPendingOffer(o._id);
                             setClarificationError((current) => ({ ...current, [o._id]: "" }));
                             try {
                               await sendClarification({ offerId: o._id, question: drafts[o._id] });
                               setSent((current) => ({ ...current, [o._id]: true }));
                             } catch (cause) {
                               setClarificationError((current) => ({ ...current, [o._id]: userFacingError(cause, "Could not send clarification") }));
                             } finally {
                               setPendingOffer(null);
                             }
                          }}
                          className="rounded-lg border border-hairline bg-sheet px-3 py-1.5 text-xs font-medium text-ink hover:bg-paper disabled:opacity-50"
                        >
                          {sent[o._id] ? "Approved, sent" : "Approve & send"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {clarificationError[o._id] && <div role="alert" className="mt-2 text-[11px] text-seal">{clarificationError[o._id]}</div>}

              {!o.isVerified && certRequired && (
                <div className="mt-3 rounded-lg border border-hairline bg-paper p-3">
                  <div className="eyebrow">Independent certification check</div>
                  <p className="mt-1 text-[11px] leading-relaxed text-soft">Paste an authoritative HTTPS page that contains both the required certification and the exact product or model identifier.</p>
                  <div className="mt-2 flex gap-2">
                    <input
                      type="url"
                      aria-label={`Verification URL for ${o.supplier?.name ?? "supplier"}`}
                      value={verificationUrl[o._id] ?? ""}
                      onChange={(event) => setVerificationUrl((current) => ({ ...current, [o._id]: event.target.value }))}
                      placeholder="https://manufacturer.example/product"
                      className="input-field min-w-0 flex-1"
                    />
                    <button
                      disabled={pendingOffer === o._id || !verificationUrl[o._id]}
                      onClick={async () => {
                        setPendingOffer(o._id);
                        setVerificationMessage((current) => ({ ...current, [o._id]: "" }));
                        try {
                          const result = await verifyOffer({ offerId: o._id, type: "cert", url: verificationUrl[o._id] });
                          setVerificationMessage((current) => ({ ...current, [o._id]: result.status === "verified" ? "Certification verified" : "Source saved for review; exact authoritative evidence did not match" }));
                        } catch (cause) {
                          setVerificationMessage((current) => ({ ...current, [o._id]: userFacingError(cause, "Could not verify source") }));
                        } finally {
                          setPendingOffer(null);
                        }
                      }}
                      className="rounded-lg bg-ledger px-3 py-2 text-xs font-medium text-white hover:bg-ledger-deep disabled:opacity-50"
                    >
                      {pendingOffer === o._id ? "Checking…" : "Verify"}
                    </button>
                  </div>
                  {verificationMessage[o._id] && <div role="status" className="mt-2 text-[11px] text-soft">{verificationMessage[o._id]}</div>}
                </div>
              )}

              <div className="mt-3 rounded-lg border border-hairline bg-paper p-3">
                <div className="eyebrow">Extracted email</div>
                <div className="mt-1 text-sm leading-relaxed text-ink line-clamp-3">{o.rawBody ?? (o as any).rawBody ?? "—"}</div>
                {o.sourceChecks?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {o.sourceChecks.slice(0, 2).map((s: any) => (
                      <a
                        key={s._id}
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-md border border-[#bfd9c9] bg-[#eaf2ed] px-2 py-0.5 text-[11px] text-ledger underline-offset-2 hover:underline"
                      >
                        {s.type}: {s.status} — {s.quote.slice(0, 80)}
                      </a>
                    ))}
                  </div>
                ) : null}
                {certRequired ? <EvidenceAttach offerId={o._id} /> : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-hairline bg-paper px-4 py-3">
        <p className="text-[11px] text-soft">Quotes update live as supplier replies are ingested.</p>
        <details open className="mt-2">
          <summary className="cursor-pointer text-xs font-semibold text-ink">Paste another quote</summary>
          <PasteQuote needId={needId} suppliers={suppliers ?? []} need={need} />
        </details>
      </div>
    </div>
  );
}
