import { useAction, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";

type PublicRecallCheckProps = {
  needId?: any;
  coverage: number;
  target: number;
};

// Real-world evidence watch for customer needs: Firecrawl searches public
// recall sources (CPSC, FDA, NSF) for the need's exact product identifiers.
// A confirmed authoritative match freezes every affected offer through the
// same transactional evidence path as allocation approval. No match means no writes.
export function PublicRecallCheck({ needId, coverage, target }: PublicRecallCheckProps) {
  const checkRecalls = useAction(api.actions.checkPublicRecalls.checkPublicRecalls);
  const approveNotice = useAction(api.actions.holdNotice.approveAndSendHoldNotice);
  const state = useQuery(api.evidenceDrift.getEvidenceDriftState, needId ? { needId } : {});
  const notice = state?.holdNotice;
  const canSendHoldNotice = Boolean(state?.canSendHoldNotice);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<null | { recalled: boolean; checked: number; note?: string; sourceUrl?: string; invalidated?: number }>(null);
  const [error, setError] = useState<string | null>(null);

  const runCheck = async () => {
    if (!needId) return;
    setPending(true);
    setError(null);
    try {
      const res = await checkRecalls({ needId });
      setResult({ recalled: res.recalled, checked: res.checked, note: res.note ?? undefined, sourceUrl: res.sourceUrl ?? undefined, invalidated: res.invalidated ?? undefined });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not check public recalls");
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="card p-4">
      <div className="eyebrow">Public recall watch</div>
      <p className="mt-1 text-xs leading-relaxed text-soft">
        Firecrawl checks public recall sources for this exact product. A confirmed match freezes the affected offers and drafts a hold notice.
      </p>
      <button
        disabled={!needId || pending}
        onClick={() => void runCheck()}
        className="mt-3 w-full rounded-lg border border-hairline bg-sheet px-3 py-2 text-xs font-medium text-ink hover:bg-paper disabled:opacity-50"
      >
        {pending ? "Checking public sources…" : "Check public recalls"}
      </button>
      {result && !result.recalled && (
        <div className="mt-3 rounded-lg border border-[#bfd9c9] bg-[#eaf2ed] p-3 text-xs text-ledger">
          No recalls found in public sources{result.checked ? `, ${result.checked} authoritative ${result.checked === 1 ? "page" : "pages"} read` : ""}{result.note ? `, ${result.note}` : ""}.
        </div>
      )}
      {result?.recalled && (
        <div className="mt-3 rounded-lg border border-seal bg-[#f9ece7] p-3">
          <div className="text-xs font-semibold text-seal">
            Recall found — {result.invalidated ?? 0} {(result.invalidated ?? 0) === 1 ? "offer" : "offers"} frozen
          </div>
          <div className="mt-1 text-[11px] tabular-nums text-seal">Coverage {coverage}/{target}, plan recomputed</div>
          {result.sourceUrl && <a href={result.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[11px] font-medium text-ledger underline underline-offset-4">Read the recall source</a>}
        </div>
      )}
      {notice && (
        <div className="mt-3 rounded-lg border border-[#e7d9ae] bg-[#fbf7ea] p-3">
          <div className="text-[11px] font-semibold text-[#7a5c14]">Hold notice, {notice.status}</div>
          <div className="mt-1 text-xs font-semibold">{notice.subject}</div>
          {notice.status === "draft" && (
            <button
              disabled={!canSendHoldNotice || pending}
              onClick={() => {
                setPending(true);
                setError(null);
                void approveNotice({ noticeId: notice._id })
                  .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not send hold notice"))
                  .finally(() => setPending(false));
              }}
              className="mt-2 rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-paper hover:opacity-90 disabled:opacity-40"
            >
              Approve &amp; send hold notice
            </button>
          )}
          {notice.status === "draft" && !canSendHoldNotice && <div className="mt-2 text-[10px] text-soft">Draft retained: delivery requires a real sent supplier thread.</div>}
        </div>
      )}
      {error && <div role="alert" className="mt-3 rounded-lg border border-[#edc4b6] bg-[#f9ece7] p-3 text-xs text-seal">{error}</div>}
    </section>
  );
}
