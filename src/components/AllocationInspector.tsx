import { formatCents } from "../lib/format";

export function AllocationInspector({ plan, need }: any) {
  if (!need) return <div className="rounded-2xl bg-[#111827] border border-[#1e2d4a] p-6 text-sm text-slate-400">Create a need to compute allocation.</div>;
  if (!plan) {
    return (
      <div className="rounded-2xl bg-[#111827] border border-[#1e2d4a] p-6">
        <div className="text-sm font-semibold">Allocation Inspector</div>
        <div className="text-sm text-slate-400 mt-1">No plan yet. The allocator needs at least one verified offer before it can propose a cheapest-feasible split.</div>
        <div className="mt-3 text-xs mono text-slate-500">Constraints: qty ≥ {need.qty} · deadline {new Date(need.deadlineAt).toLocaleTimeString()} · budget {formatCents(need.budgetCents)} · cert {need.certRequired}</div>
      </div>
    );
  }

  const isApproved = plan.status === "approved";

  return (
    <div className="rounded-2xl bg-[#111827] border border-[#1e2d4a] overflow-hidden">
      <div className="px-4 py-3 border-b border-[#1e2d4a] flex items-center justify-between">
        <div className="text-xs tracking-[0.14em] uppercase text-slate-400">Allocation Inspector</div>
        <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${isApproved ? "bg-emerald-500 text-white border-emerald-600" : "bg-amber-500/10 text-amber-300 border-amber-500/20"}`}>
          {isApproved ? "APPROVED" : "PROPOSED"}
        </span>
      </div>

      <div className="p-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-[#1a2332] border border-[#1e2d4a] p-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">Total</div>
            <div className="text-lg font-bold mt-1">{plan.totalQty} units</div>
            <div className="text-xs text-slate-400">need {need.qty}</div>
          </div>
          <div className="rounded-xl bg-[#1a2332] border border-[#1e2d4a] p-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">Cost</div>
            <div className="text-lg font-bold mt-1">{formatCents(plan.totalCostCents)}</div>
            <div className="text-xs text-slate-400">of {formatCents(need.budgetCents)}</div>
          </div>
          <div className="rounded-xl bg-[#1a2332] border border-[#1e2d4a] p-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">Feasible</div>
            <div className={`text-lg font-bold mt-1 ${plan.totalQty >= need.qty ? "text-emerald-400" : "text-amber-400"}`}>{plan.totalQty >= need.qty ? "Yes" : "Partial"}</div>
            <div className="text-xs text-slate-400">{plan.status}</div>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-[#1e2d4a]">
          <table className="w-full text-sm">
            <thead className="bg-[#0f172a] text-[11px] tracking-[0.14em] uppercase text-slate-400">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Supplier</th>
                <th className="text-right px-3 py-2 font-medium">Qty</th>
                <th className="text-right px-3 py-2 font-medium">Cost</th>
                <th className="text-left px-3 py-2 font-medium">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e2d4a]">
              {plan.lines?.map((l: any) => (
                <tr key={l._id} className="bg-[#111827]">
                  <td className="px-3 py-2 font-medium">{l.supplier?.name ?? l.supplierId.slice(0, 8)}</td>
                  <td className="px-3 py-2 text-right mono">{l.qty}</td>
                  <td className="px-3 py-2 text-right mono">{formatCents(l.costCents)}</td>
                  <td className="px-3 py-2 text-xs text-slate-400">{l.reason}</td>
                </tr>
              ))}
              {!plan.lines?.length && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                    No lines — allocator rejected all offers (see trace below). The cheapest (BlueRiver $9) loses because it misses the deadline.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {plan.decisionTrace && (
          <div className="mt-3 rounded-xl bg-[#0f172a] border border-[#1e2d4a] p-3">
            <div className="text-xs tracking-[0.14em] uppercase text-slate-500">Decision trace (deterministic)</div>
            <pre className="mt-2 text-[11px] mono leading-relaxed text-slate-300 whitespace-pre-wrap">{plan.decisionTrace}</pre>
          </div>
        )}

        <div className="mt-3 text-[11px] leading-relaxed text-slate-500">
          Deterministic allocator in <span className="mono text-slate-300">convex/lib/allocate.ts</span> — OpenAI extracts, code decides. Cheapest-late (BlueRiver 100×$9) is rejected; 70×$11 + 30×$10 = $1,070 wins.
        </div>
      </div>
    </div>
  );
}
