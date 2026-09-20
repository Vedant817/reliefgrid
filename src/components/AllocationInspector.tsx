import { formatCents, friendlyReason, humanizeStatus } from "../lib/format";

export function AllocationInspector({ plan, need }: any) {
  if (!need) return <div className="card p-6 text-sm text-soft">Create a need to compute allocation.</div>;
  if (!plan) {
    return (
      <div className="card p-6">
        <div className="text-sm font-semibold">Allocation Inspector</div>
        <div className="mt-1 text-sm text-soft">No plan yet. The allocator needs at least one verified offer before it can propose a cheapest-feasible split.</div>
        <div className="mt-3 text-xs tabular-nums text-soft">Constraints: qty ≥ {need.qty}, deadline {new Date(need.deadlineAt).toLocaleTimeString()}, budget {formatCents(need.budgetCents)}, cert {need.certRequired}</div>
      </div>
    );
  }

  const isApproved = plan.status === "approved";

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
        <div className="eyebrow">Allocation Inspector</div>
        <span key={isApproved ? "approved" : "proposed"} className={`stamp ${isApproved ? "seal-in border-ledger bg-[#eaf2ed] text-ledger" : "border-[#e7d9ae] bg-[#fbf7ea] text-[#7a5c14]"}`}>
          {isApproved ? "Approved" : "Proposed"}
        </span>
      </div>

      <div className="p-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-hairline bg-paper p-3">
            <div className="eyebrow">Total</div>
            <div className="mt-1 text-lg font-bold tabular-nums">{plan.totalQty} units</div>
            <div className="text-xs text-soft">need {need.qty}</div>
          </div>
          <div className="rounded-lg border border-hairline bg-paper p-3">
            <div className="eyebrow">Cost</div>
            <div className="mt-1 text-lg font-bold tabular-nums">{formatCents(plan.totalCostCents)}</div>
            <div className="text-xs text-soft">of {formatCents(need.budgetCents)}</div>
          </div>
          <div className="rounded-lg border border-hairline bg-paper p-3">
            <div className="eyebrow">Feasible</div>
            <div className={`mt-1 text-lg font-bold ${plan.totalQty >= need.qty ? "text-ledger" : "text-[#7a5c14]"}`}>{plan.totalQty >= need.qty ? "Yes" : "Partial"}</div>
            <div className="text-xs text-soft">{humanizeStatus(plan.status)}</div>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-lg border border-hairline">
          <table className="w-full text-sm">
            <thead className="bg-paper text-[11px] font-semibold text-soft">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Supplier</th>
                <th className="px-3 py-2 text-right font-medium">Qty</th>
                <th className="px-3 py-2 text-right font-medium">Cost</th>
                <th className="px-3 py-2 text-left font-medium">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {plan.lines?.map((l: any) => (
                <tr key={l._id} className="bg-sheet">
                  <td className="px-3 py-2 font-medium">{l.supplier?.name ?? l.supplierId.slice(0, 8)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.qty}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCents(l.costCents)}</td>
                  <td className="px-3 py-2 text-xs text-soft">{friendlyReason(l.reason)}</td>
                </tr>
              ))}
              {!plan.lines?.length && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-soft">
                    No eligible allocation lines. Review the decision trace below to see which constraints rejected each offer.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {plan.decisionTrace && (
          <div className="mt-3 rounded-lg border border-hairline bg-paper p-3">
            <div className="eyebrow">Decision trace (deterministic)</div>
            <pre className="mt-2 whitespace-pre-wrap text-[11px] tabular-nums leading-relaxed text-soft">{plan.decisionTrace}</pre>
          </div>
        )}

        <div className="mt-3 text-[11px] leading-relaxed text-soft">
          Supplier emails are extracted by the configured language model, but deterministic code applies the quantity, deadline, budget, confidence, and evidence rules. A person must approve the result.
        </div>
      </div>
    </div>
  );
}
