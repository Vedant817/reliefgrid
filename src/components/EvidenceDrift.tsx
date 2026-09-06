import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";

type EvidenceDriftProps = {
  needId?: any;
  coverage: number;
  target: number;
};

export function EvidenceDrift({ needId, coverage, target }: EvidenceDriftProps) {
  const state = useQuery(api.evidenceDrift.getEvidenceDriftState, needId ? { needId } : {});
  const activateRecall = useAction(api.actions.recheckSource.activateRecallAndRecheck);
  const addReplacement = useMutation(api.evidenceDrift.addReplacementOffer);
  const approveNotice = useAction(api.actions.holdNotice.approveAndSendHoldNotice);
  const bulletin = state?.bulletin;
  const notice = state?.holdNotice;
  const canSendHoldNotice = Boolean(state?.canSendHoldNotice);
  const recalled = bulletin?.state === "RECALL_ACTIVE";
  const startRecovery = useMutation(api.recoveryWorkflow.startRecovery);
  const approveRecovery = useMutation(api.recoveryWorkflow.approveRecovery);
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wfStatus: any = useQuery(
    api.recoveryWorkflow.recoveryStatus,
    workflowId ? { workflowId } : "skip",
  );
  const wfState: string = wfStatus?.type ?? "idle";
  const wfAwaiting = wfStatus?.type === "inProgress" && (wfStatus?.running ?? []).some((s: any) => s.kind === "event");

  const run = async (name: string, operation: () => Promise<unknown>) => {
    setPending(name);
    setError(null);
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${name} failed`);
    } finally {
      setPending(null);
    }
  };

  return (
    <section className={`card overflow-hidden ${recalled ? "border-seal" : ""}`}>
      <div className={`flex items-start justify-between gap-3 border-b p-4 ${recalled ? "border-[#edc4b6] bg-[#f9ece7]" : "border-hairline"}`}>
        <div>
          <div className={`eyebrow ${recalled ? "text-seal" : ""}`}>Evidence drift</div>
          <div className="mt-1 font-semibold">NF-53 safety source</div>
        </div>
        <span className={`rounded-[4px] border-2 px-2 py-0.5 text-[11px] font-bold tabular-nums ${recalled ? "border-seal bg-seal text-white" : "border-ledger bg-[#eaf2ed] text-ledger"}`}>
          {bulletin?.state ?? "LOADING"}
        </span>
      </div>
      <div className="p-4">
        <p className="text-xs leading-relaxed text-soft">{bulletin?.body ?? "Waiting for demo bulletin."}</p>
        <a href={bulletin ? `/demo-bulletin?id=${encodeURIComponent(String(bulletin._id))}` : undefined} target="_blank" rel="noreferrer" aria-disabled={!bulletin} className="mt-2 inline-block text-xs font-medium text-ledger underline underline-offset-4 aria-disabled:opacity-40">Open controlled public bulletin</a>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button disabled={!needId || recalled || Boolean(pending)} onClick={() => needId && void run("Evidence recheck", () => activateRecall({ needId }))} className="rounded-lg border border-seal bg-sheet px-3 py-2 text-xs font-medium text-seal hover:bg-[#f9ece7] disabled:opacity-40">
            {pending === "Evidence recheck" ? "Rechecking…" : "Recheck changed source"}
          </button>
          <button disabled={!needId || !recalled || coverage >= target || Boolean(pending)} onClick={() => needId && void run("Replacement", () => addReplacement({ needId }))} className="rounded-lg bg-ledger px-3 py-2 text-xs font-medium text-white hover:bg-ledger-deep disabled:opacity-40">
            {pending === "Replacement" ? "Adding…" : "Add replacement"}
          </button>
        </div>
        {recalled && (
          <div className="mt-3 rounded-lg border border-[#edc4b6] bg-[#f9ece7] p-3">
            <div className="text-xs font-semibold text-seal">Causal change: Apex invalidated</div>
            <div className="mt-1 text-[11px] tabular-nums text-seal">Coverage {coverage}/{target}, plan recomputed transactionally</div>
          </div>
        )}
        {notice && (
          <div className="mt-3 rounded-lg border border-[#e7d9ae] bg-[#fbf7ea] p-3">
            <div className="text-[11px] font-semibold text-[#7a5c14]">Hold notice, {notice.status}</div>
            <div className="mt-1 text-xs font-semibold">{notice.subject}</div>
            <p className="mt-1 text-[11px] text-soft">{notice.body}</p>
            {notice.status === "draft" && (
              <button disabled={!canSendHoldNotice || Boolean(pending)} onClick={() => void run("Hold notice", () => approveNotice({ noticeId: notice._id }))} className="mt-2 rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-paper hover:opacity-90 disabled:opacity-40">
                {pending === "Hold notice" ? "Sending…" : "Approve & send hold notice"}
              </button>
            )}
            {notice.status === "draft" && !canSendHoldNotice && <div className="mt-2 text-[10px] text-soft">Draft retained: delivery requires a real sent supplier thread.</div>}
          </div>
        )}
        <div className="mt-3 text-[10px] tabular-nums text-soft">Firecrawl reads the public Convex bulletin before the source check can invalidate the plan. Hold notices remain human-approved.</div>
        <div className="mt-3 rounded-lg border border-hairline bg-paper p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] font-semibold text-soft">Guided recovery, durable workflow</div>
            <span className="text-[10px] tabular-nums text-soft">{wfState}{wfStatus?.type === "completed" ? `, ${wfStatus.result?.recoveredQty ?? "?"} units recovered` : ""}</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              disabled={!needId || !recalled || coverage >= target || Boolean(pending)}
              onClick={async () => {
                await run("Guided recovery", async () => {
                  const res = await startRecovery({ needId });
                  setWorkflowId(res.workflowId);
                });
              }}
              className="rounded-lg bg-ledger px-3 py-2 text-xs font-medium text-white hover:bg-ledger-deep disabled:opacity-40"
            >
              Start guided recovery
            </button>
            <button
              disabled={!workflowId || !wfAwaiting || Boolean(pending)}
              onClick={() => workflowId && void run("Recovery approval", () => approveRecovery({ workflowId }))}
              className="rounded-lg bg-ledger px-3 py-2 text-xs font-medium text-white hover:bg-ledger-deep disabled:opacity-40"
            >
              Approve recovery
            </button>
          </div>
          <div className="mt-2 text-[10px] tabular-nums text-soft">Steps retry and resume; approval pauses the run with zero resource use.</div>
        </div>
        {error && <div role="alert" className="mt-3 rounded-lg border border-[#edc4b6] bg-[#f9ece7] p-3 text-xs text-seal">{error}</div>}
      </div>
    </section>
  );
}
