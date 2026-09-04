import { useQuery, usePaginatedQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

const tone: Record<string, string> = {
  live: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
  mock: "bg-slate-500/10 text-slate-300 border-slate-500/20",
  degraded: "bg-amber-500/10 text-amber-300 border-amber-500/20",
  not_configured: "bg-slate-500/10 text-slate-400 border-slate-500/20",
  failed: "bg-red-500/10 text-red-300 border-red-500/20",
};

export function ProviderProof() {
  const health: any = useQuery(api.health.getProviderHealth) ?? [];
  const { results: runs, status, loadMore } = usePaginatedQuery(
    api.health.listProviderRunsPage,
    {},
    { initialNumItems: 6 },
  );

  return (
    <div className="rounded-2xl bg-[#111827] border border-[#1e2d4a] overflow-hidden">
      <div className="px-4 py-3 border-b border-[#1e2d4a] flex items-center justify-between">
        <div className="text-xs tracking-[0.14em] uppercase text-slate-400">Integration health</div>
        <span className="text-[11px] mono text-slate-500">safe proof only</span>
      </div>
      <div className="p-4 grid grid-cols-2 gap-2">
        {health.map((h: any) => (
          <div key={h.provider} className="rounded-xl bg-[#1a2332] border border-[#1e2d4a] p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold capitalize">{h.provider}</span>
              <span className={`text-[11px] px-2 py-0.5 rounded-full border ${tone[h.status] ?? tone.mock}`}>{h.status}</span>
            </div>
            <div className="text-[11px] text-slate-400 mt-1">{h.detail}</div>
            {h.lastRun?.requestId && (
              <div className="text-[11px] mono text-slate-500 mt-1 truncate">req {h.lastRun.requestId} · {h.lastRun.latencyMs ?? "?"}ms</div>
            )}
          </div>
        ))}
        {!health.length && <div className="text-xs text-slate-500 col-span-2">Loading health…</div>}
      </div>
      {runs.length > 0 && (
        <div className="px-4 pb-4">
          <div className="text-[11px] tracking-[0.14em] uppercase text-slate-500">Recent runs</div>
          <div className="mt-2 space-y-1">
            {runs.map((r: any) => (
              <div key={r._id} className="text-[11px] mono text-slate-400 flex justify-between gap-2">
                <span>{r.provider}/{r.operation} · {r.status}</span>
                <span>{r.latencyMs ?? "?"}ms</span>
              </div>
            ))}
          </div>
          {status === "CanLoadMore" && (
            <button onClick={() => loadMore(6)} className="mt-2 text-[11px] text-cyan-300 underline underline-offset-4">
              Load more runs
            </button>
          )}
        </div>
      )}
    </div>
  );
}
