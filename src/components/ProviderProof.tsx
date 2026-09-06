import { useQuery, usePaginatedQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

const tone: Record<string, string> = {
  live: "border-ledger bg-[#eaf2ed] text-ledger",
  mock: "border-hairline bg-paper text-soft",
  degraded: "border-[#e7d9ae] bg-[#fbf7ea] text-[#7a5c14]",
  not_configured: "border-hairline bg-paper text-soft",
  failed: "border-seal bg-[#f9ece7] text-seal",
};

export function ProviderProof() {
  const health: any = useQuery(api.health.getProviderHealth) ?? [];
  const { results: runs, status, loadMore } = usePaginatedQuery(
    api.health.listProviderRunsPage,
    {},
    { initialNumItems: 6 },
  );

  return (
    <div className="overflow-hidden rounded-[10px] border border-hairline bg-sheet">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
        <div className="eyebrow">Integration health</div>
        <span className="text-[11px] tabular-nums text-soft">safe proof only</span>
      </div>
      <div className="grid grid-cols-2 gap-2 p-4">
        {health.map((h: any) => (
          <div key={h.provider} className="rounded-lg border border-hairline bg-paper p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold capitalize">{h.provider}</span>
              <span className={`rounded-[4px] border px-2 py-0.5 text-[11px] font-semibold ${tone[h.status] ?? tone.mock}`}>{h.status}</span>
            </div>
            <div className="mt-1 text-[11px] text-soft">{h.detail}</div>
            {h.lastRun?.requestId && (
              <div className="mt-1 truncate text-[11px] tabular-nums text-soft">req {h.lastRun.requestId}, {h.lastRun.latencyMs ?? "?"}ms</div>
            )}
          </div>
        ))}
        {!health.length && <div className="col-span-2 text-xs text-soft">Loading health…</div>}
      </div>
      {runs.length > 0 && (
        <div className="px-4 pb-4">
          <div className="text-[11px] font-semibold text-soft">Recent runs</div>
          <div className="mt-2 space-y-1">
            {runs.map((r: any) => (
              <div key={r._id} className="flex justify-between gap-2 text-[11px] tabular-nums text-soft">
                <span>{r.provider}/{r.operation}, {r.status}</span>
                <span>{r.latencyMs ?? "?"}ms</span>
              </div>
            ))}
          </div>
          {status === "CanLoadMore" && (
            <button onClick={() => loadMore(6)} className="mt-2 text-[11px] font-medium text-ledger underline underline-offset-4">
              Load more runs
            </button>
          )}
        </div>
      )}
    </div>
  );
}
