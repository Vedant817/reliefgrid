import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import usePresence from "@convex-dev/presence/react";
import { api } from "../../convex/_generated/api";
import { formatCents, formatDate } from "../lib/format";
import { getSessionAlias } from "../lib/session";

function ReviewingNow({ needId }: { needId: any }) {
  const alias = getSessionAlias();
  const state = usePresence(api.presence, `need-${needId}`, `${alias}-review`);
  const others = (state ?? []).filter((p: any) => !String(p.userId ?? "").startsWith(alias));
  if (!others.length) return null;
  return (
    <span className="text-[11px] px-2 py-1 rounded-full border border-violet-400/20 bg-violet-400/10 text-violet-300">
      {others.length} reviewing
    </span>
  );
}

function EvidenceAttach({ offerId }: { offerId: any }) {
  const attachments: any = useQuery(api.attachments.listAttachmentsByOffer, { offerId }) ?? [];
  const generateUrl = useMutation(api.attachments.generateUploadUrl);
  const record = useMutation(api.attachments.recordAttachment);
  const remove = useMutation(api.attachments.removeAttachment);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const url = await generateUrl({ offerId });
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
      if (!res.ok) throw new Error("upload failed");
      const { storageId } = await res.json();
      await record({ offerId, storageId, name: file.name, contentType: file.type, size: file.size });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[11px] px-2 py-1 rounded-full border border-slate-500/20 bg-slate-500/10 text-slate-300 cursor-pointer">
          {busy ? "Uploading…" : "+ Cert evidence"}
          <input type="file" className="hidden" disabled={busy} onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
        {attachments.map((a: any) => (
          <span key={a._id} className="text-[11px] mono px-2 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 flex items-center gap-1">
            <a href={a.url ?? undefined} target="_blank" rel="noreferrer" className="underline underline-offset-2">{a.name}</a>
            <button onClick={() => void remove({ attachmentId: a._id })} className="text-slate-500">×</button>
          </span>
        ))}
      </div>
    </div>
  );
}

function Badge({ children, tone }: any) {
  const map: any = {
    verified: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
    late: "bg-red-500/10 text-red-300 border-red-500/20",
    review: "bg-amber-500/10 text-amber-300 border-amber-500/20",
    neutral: "bg-slate-500/10 text-slate-300 border-slate-500/20",
  };
  return <span className={`text-[11px] px-2 py-1 rounded-full border ${map[tone] ?? map.neutral}`}>{children}</span>;
}

export function OfferMatrix({ offers, activeNeed }: any) {
  const coverage: any = useQuery(
    api.offerTotals.getNeedCoverage,
    activeNeed ? { needId: activeNeed._id } : "skip",
  );
  const draftClarification = useAction(api.actions.clarify.draftClarification);
  const sendClarification = useAction(api.actions.clarify.approveAndSendClarification);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [draftStatus, setDraftStatus] = useState<Record<string, string>>({});
  const [sent, setSent] = useState<Record<string, boolean>>({});

  if (!activeNeed) {
    return (
      <div className="rounded-2xl bg-[#111827] border border-[#1e2d4a] p-6 text-sm text-slate-400">Select a need to view offers.</div>
    );
  }
  if (!offers.length) {
    return (
      <div className="rounded-2xl bg-[#111827] border border-[#1e2d4a] p-6">
        <div className="text-sm font-semibold">Live Offer Matrix</div>
        <div className="text-sm text-slate-400 mt-1">No offers yet. Seed will simulate 3 synthetic supplier replies (EN + Spanish) via AgentMail webhooks.</div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-xl bg-[#1a2332] border border-[#1e2d4a] p-3">Apex 70 × $11 — 4 PM · EN</div>
          <div className="rounded-xl bg-[#1a2332] border border-[#1e2d4a] p-3">BlueRiver 100 × $9 — tomorrow · late</div>
          <div className="rounded-xl bg-[#1a2332] border border-[#1e2d4a] p-3">Casa 30 × $10 — 5 PM · ES</div>
        </div>
      </div>
    );
  }

  // Sort: verified first, then price
  const sorted = [...offers].sort((a, b) => {
    const av = a.certStatus === "verified" ? 0 : 1;
    const bv = b.certStatus === "verified" ? 0 : 1;
    return av - bv || a.unitPriceCents - b.unitPriceCents;
  });

  return (
    <div className="rounded-2xl bg-[#111827] border border-[#1e2d4a] overflow-hidden">
      <div className="px-4 py-3 border-b border-[#1e2d4a] flex items-center justify-between">
        <div className="text-xs tracking-[0.14em] uppercase text-slate-400">Live Offer Matrix</div>
        <span className="text-xs mono text-slate-400 flex items-center gap-2">
          {offers.length} offers · {coverage?.totalQty ?? "?"} units quoted · realtime
          {activeNeed && <ReviewingNow needId={activeNeed._id} />}
        </span>
      </div>

      <div className="divide-y divide-[#1e2d4a]">
        {sorted.map((o: any) => {
          const isLate = activeNeed && o.arrivalAt > activeNeed.deadlineAt;
          const isVerified = o.certStatus === "verified";
          const ambiguous = o.certStatus === "needs_review" || o.confidence < 0.75;
          return (
            <div key={o._id} className="p-4 hover:bg-[#1a2332]/50">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-sm flex items-center gap-2">
                    {o.supplier?.name ?? "Unknown supplier"}
                    {o.language === "es" && <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-500 text-white">ES → EN</span>}
                  </div>
                  <div className="text-xs mono text-slate-400 mt-0.5">{o.supplier?.contactEmail ?? ""}</div>
                </div>
                <div className="text-right">
                  <div className="font-bold">{formatCents(o.unitPriceCents)} <span className="font-normal text-slate-400 text-xs">× {o.qty}</span></div>
                  <div className="text-xs text-slate-400">= {formatCents(o.qty * o.unitPriceCents)} total</div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {isVerified ? <Badge tone="verified">NSF/ANSI 53 verified</Badge> : <Badge tone="review">Cert {o.certStatus}</Badge>}
                {isLate ? <Badge tone="late">Late — {formatDate(o.arrivalAt)}</Badge> : <Badge tone="neutral">{formatDate(o.arrivalAt)}</Badge>}
                <Badge tone={o.confidence > 0.9 ? "verified" : "review"}>{(o.confidence * 100).toFixed(0)}% confidence</Badge>
                {o.conditions?.map((c: string, i: number) => (
                  <Badge key={i} tone="review">{c}</Badge>
                ))}
              </div>

              {o.fieldEvidence && (
                <div className="mt-2 flex flex-wrap gap-2 text-[10px] mono text-slate-500">
                  {Object.entries(o.fieldEvidence).map(([field, evidence]: [string, any]) => (
                    <span key={field} className={evidence.confidence < 0.75 ? "text-amber-300" : ""}>
                      {field} {Math.round(evidence.confidence * 100)}%
                    </span>
                  ))}
                </div>
              )}

              {ambiguous && (
                <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3">
                  <div className="text-xs font-semibold text-amber-200">Allocator abstained</div>
                  {!drafts[o._id] ? (
                    <button
                      onClick={async () => {
                        const result = await draftClarification({ offerId: o._id });
                        setDrafts((current) => ({ ...current, [o._id]: result.question }));
                        setDraftStatus((current) => ({ ...current, [o._id]: result.providerStatus }));
                      }}
                      className="mt-2 px-3 py-1.5 rounded-full bg-amber-300 text-[#1c1505] text-xs font-bold"
                    >
                      Draft targeted clarification
                    </button>
                  ) : (
                    <div className="mt-2">
                      <p className="text-xs text-slate-300">{drafts[o._id]}</p>
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-[10px] mono text-slate-500">LLM: {draftStatus[o._id] ?? "live"}</span>
                        <button
                          disabled={sent[o._id]}
                          onClick={async () => {
                            await sendClarification({ offerId: o._id, approvedBy: "coordinator@reliefgrid.test" });
                            setSent((current) => ({ ...current, [o._id]: true }));
                          }}
                          className="px-3 py-1.5 rounded-full border border-amber-300/30 text-amber-200 text-xs disabled:opacity-50"
                        >
                          {sent[o._id] ? "Approved · sent" : "Approve & send"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-3 rounded-xl bg-[#0f172a] border border-[#1e2d4a] p-3">
                <div className="text-xs tracking-[0.14em] uppercase text-slate-500">Extracted email</div>
                <div className="text-sm text-slate-300 mt-1 leading-relaxed line-clamp-3">{o.rawBody ?? (o as any).rawBody ?? "—"}</div>
                {o.sourceChecks?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {o.sourceChecks.slice(0, 2).map((s: any) => (
                      <span key={s._id} className="text-[11px] mono px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">
                        {s.type}: {s.status} — {s.quote.slice(0, 40)}…
                      </span>
                    ))}
                  </div>
                ) : null}
                <EvidenceAttach offerId={o._id} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="px-4 py-3 bg-[#0f172a] border-t border-[#1e2d4a] text-[11px] mono text-slate-500">
        Convex realtime: <span className="text-slate-300">useQuery(listOffersByNeed)</span> updates without refresh · Firecrawl checks stored as <span className="text-slate-300">sourceChecks</span> · live LLM extraction confidence shown per row
      </div>
    </div>
  );
}
