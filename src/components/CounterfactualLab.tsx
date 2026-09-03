import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { formatCents } from "../lib/format";

export function CounterfactualLab({ needId }: { needId?: any }) {
  const [hours, setHours] = useState(16);
  const result = useQuery(
    api.counterfactual.compareConstraints,
    needId ? { needId, deadlineExtensionHours: hours } : "skip",
  );

  return (
    <section className="rounded-2xl bg-[#111827] border border-[#1e2d4a] overflow-hidden">
      <div className="px-4 py-3 border-b border-[#1e2d4a] flex justify-between gap-3">
        <div>
          <div className="text-xs tracking-[0.14em] uppercase text-slate-400">Counterfactual lab</div>
          <div className="text-[11px] text-slate-500 mt-1">Pure allocator · zero writes</div>
        </div>
        <span className="text-[10px] mono text-cyan-300 border border-cyan-400/20 rounded-full px-2 py-1">WHAT IF?</span>
      </div>
      <div className="p-4">
        <label className="text-xs font-semibold flex justify-between">
          Relax deadline <span className="mono text-cyan-300">+{hours}h</span>
        </label>
        <input type="range" min="0" max="24" value={hours} onChange={(event) => setHours(Number(event.target.value))} className="w-full mt-3 accent-cyan-400" />
        {result && (
          <>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-[#0f172a] border border-[#1e2d4a] p-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Live plan</div>
                <div className="font-bold mt-1">{result.baseline.totalQty} units</div>
                <div className="text-xs text-slate-400">{formatCents(result.baseline.totalCostCents)}</div>
              </div>
              <div className="rounded-xl bg-cyan-400/10 border border-cyan-400/20 p-3">
                <div className="text-[10px] uppercase tracking-wider text-cyan-300">Hypothesis</div>
                <div className="font-bold mt-1">{result.hypothetical.totalQty} units</div>
                <div className="text-xs text-slate-300">{formatCents(result.hypothetical.totalCostCents)}</div>
              </div>
            </div>
            {result.savingsCents > 0 && <div className="mt-3 text-xs text-emerald-300">Would save {formatCents(result.savingsCents)}; live plan unchanged.</div>}
            <div className="mt-3 space-y-1">
              {result.baseline.rejected.map((offer: any) => (
                <details key={offer.offerId} className="rounded-lg border border-[#1e2d4a] bg-[#0f172a] px-3 py-2">
                  <summary className="text-xs cursor-pointer">Why not {offer.supplierName}?</summary>
                  <p className="text-[11px] text-amber-300 mt-1">{offer.reason}</p>
                </details>
              ))}
            </div>
            <div className="mt-3 text-[10px] mono text-slate-500">No plan, approval, thread, or audit mutation is called by this query.</div>
          </>
        )}
      </div>
    </section>
  );
}
