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
  const activateRecall = useMutation(api.evidenceDrift.activateRecall);
  const addReplacement = useMutation(api.evidenceDrift.addReplacementOffer);
  const approveNotice = useAction(api.actions.holdNotice.approveAndSendHoldNotice);
  const bulletin = state?.bulletin;
  const notice = state?.holdNotice;
  const recalled = bulletin?.state === "RECALL_ACTIVE";
  const startRecovery = useMutation(api.recoveryWorkflow.startRecovery);
  const approveRecovery = useMutation(api.recoveryWorkflow.approveRecovery);
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const wfStatus: any = useQuery(
    api.recoveryWorkflow.recoveryStatus,
    workflowId ? { workflowId } : "skip",
  );
  const wfState: string = wfStatus?.type ?? "idle";
  const wfAwaiting = wfStatus?.type === "inProgress" && (wfStatus?.running ?? []).some((s: any) => s.kind === "event");

  return (
    <section className={`rounded-2xl border overflow-hidden ${recalled ? "bg-red-950/30 border-red-500/40" : "bg-[#111827] border-[#1e2d4a]"}`}>
      <div className="p-4 border-b border-inherit flex items-start justify-between gap-3">
        <div>
          <div className="text-xs tracking-[0.14em] uppercase text-slate-400">Evidence drift</div>
          <div className="font-semibold mt-1">NF-53 safety source</div>
        </div>
        <span className={`text-[11px] mono px-2 py-1 rounded-full border ${recalled ? "bg-red-500/20 border-red-400/30 text-red-200" : "bg-emerald-500/10 border-emerald-400/20 text-emerald-300"}`}>
          {bulletin?.state ?? "LOADING"}
        </span>
      </div>
      <div className="p-4">
        <p className="text-xs text-slate-400 leading-relaxed">{bulletin?.body ?? "Waiting for demo bulletin."}</p>
        <a href="/demo-bulletin" target="_blank" className="inline-block mt-2 text-xs text-cyan-300 underline underline-offset-4">Open controlled public bulletin</a>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button disabled={!needId || recalled} onClick={() => void activateRecall({})} className="px-3 py-2 rounded-xl bg-red-500/15 border border-red-500/30 text-red-200 text-xs font-semibold disabled:opacity-40">
            Flip source to recall
          </button>
          <button disabled={!recalled || coverage >= target} onClick={() => void addReplacement({})} className="px-3 py-2 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-200 text-xs font-semibold disabled:opacity-40">
            Add replacement
          </button>
        </div>
        {recalled && (
          <div className="mt-3 rounded-xl bg-black/20 border border-red-400/20 p-3">
            <div className="text-xs font-semibold text-red-200">Causal change: Apex invalidated</div>
            <div className="text-[11px] mono text-slate-400 mt-1">Coverage {coverage}/{target} · plan recomputed transactionally</div>
          </div>
        )}
        {notice && (
          <div className="mt-3 rounded-xl bg-[#0f172a] border border-[#1e2d4a] p-3">
            <div className="text-[11px] tracking-[0.12em] uppercase text-amber-300">Hold notice · {notice.status}</div>
            <div className="text-xs font-semibold mt-1">{notice.subject}</div>
            <p className="text-[11px] text-slate-400 mt-1">{notice.body}</p>
            {notice.status === "draft" && (
              <button onClick={() => void approveNotice({ noticeId: notice._id, approvedBy: "coordinator@reliefgrid.test" })} className="mt-2 px-3 py-1.5 rounded-full bg-amber-400 text-[#171006] text-xs font-bold">
                Approve & send hold notice
              </button>
            )}
          </div>
        )}
        <div className="mt-3 text-[10px] text-slate-500 mono">Offer verification runs live via Firecrawl; the controlled bulletin is local-only so its recheck is simulated. Hold-notice send runs live via AgentMail after approval.</div>
        <div className="mt-3 rounded-xl border border-violet-400/20 bg-violet-400/5 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] tracking-[0.12em] uppercase text-violet-300">Guided recovery · durable workflow</div>
            <span className="text-[10px] mono text-slate-500">{wfState}{wfStatus?.type === "completed" ? ` · ${wfStatus.result?.recoveredQty ?? "?"} units` : ""}</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              disabled={!needId}
              onClick={async () => {
                const res = await startRecovery({ needId });
                setWorkflowId(res.workflowId);
              }}
              className="px-3 py-2 rounded-xl bg-violet-500/15 border border-violet-500/30 text-violet-200 text-xs font-semibold disabled:opacity-40"
            >
              Start guided recovery
            </button>
            <button
              disabled={!workflowId || !wfAwaiting}
              onClick={() => workflowId && void approveRecovery({ workflowId })}
              className="px-3 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-200 text-xs font-semibold disabled:opacity-40"
            >
              Approve recovery
            </button>
          </div>
          <div className="mt-2 text-[10px] mono text-slate-500">Steps retry and resume; approval pauses the run with zero resource use.</div>
        </div>
      </div>
    </section>
  );
}
