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
    <section className="overflow-hidden">
      <div className="flex justify-between gap-3 border-b border-hairline px-4 py-3">
        <div>
          <div className="eyebrow">What-if scenarios</div>
          <div className="mt-1 text-[11px] text-soft">Estimates only, nothing is saved</div>
        </div>
      </div>
      <div className="p-4">
        <label className="flex justify-between text-xs font-semibold">
          Relax deadline <span className="tabular-nums text-ledger">+{hours}h</span>
        </label>
        <input type="range" min="0" max="24" value={hours} onChange={(event) => setHours(Number(event.target.value))} className="mt-3 w-full accent-ledger" />
        {result && (
          <>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-hairline bg-paper p-3">
                <div className="text-[10px] font-medium text-soft">Live plan</div>
                <div className="mt-1 font-bold tabular-nums">{result.baseline.totalQty} units</div>
                <div className="text-xs tabular-nums text-soft">{formatCents(result.baseline.totalCostCents)}</div>
              </div>
              <div className="rounded-lg border border-ledger/40 bg-[#eaf2ed] p-3">
                <div className="text-[10px] font-medium text-ledger">Hypothesis</div>
                <div className="mt-1 font-bold tabular-nums">{result.hypothetical.totalQty} units</div>
                <div className="text-xs tabular-nums text-soft">{formatCents(result.hypothetical.totalCostCents)}</div>
              </div>
            </div>
            {result.savingsCents > 0 && <div className="mt-3 text-xs font-medium text-ledger">Would save {formatCents(result.savingsCents)}; live plan unchanged.</div>}
            <div className="mt-3 space-y-1">
              {result.baseline.rejected.map((offer: any) => (
                <details key={offer.offerId} className="rounded-lg border border-hairline bg-sheet px-3 py-2">
                  <summary className="cursor-pointer text-xs font-medium">Why not {offer.supplierName}?</summary>
                  <p className="mt-1 text-[11px] text-[#7a5c14]">{offer.reason}</p>
                </details>
              ))}
            </div>
            <div className="mt-3 text-[10px] tabular-nums text-soft">Trying scenarios never changes your plan or data.</div>
          </>
        )}
      </div>
    </section>
  );
}
