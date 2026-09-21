import { formatCents, friendlyReason } from "../lib/format";

function requirementDeadline(need: any) {
  return new Date(need.deadlineAt).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(need.timezone ? { timeZone: need.timezone } : {}),
  });
}

export function AllocationInspector({ plan, need, state = "none", blockedReason, includeTrace = false }: any) {
  if (!need) return <div className="card p-6 text-sm text-soft">Create a requirement to compute a recommendation.</div>;
  if (!plan) {
    return (
      <div className="card p-6">
        <div className="text-sm font-semibold">Recommendation</div>
        <div className="mt-1 text-sm text-soft">No plan yet. At least one eligible quote is required before a complete purchase plan can be proposed.</div>
        <div className="mt-3 text-xs tabular-nums text-soft">Constraints: {need.qty} units by {requirementDeadline(need)}, budget {formatCents(need.budgetCents)}{need.certRequired ? `, certification ${need.certRequired}` : ", no certification required"}</div>
      </div>
    );
  }

  const isApproved = state === "approved" || plan.status === "approved";
  const isInfeasible = state === "infeasible" || plan.status === "infeasible";
  const isStale = state === "stale";

  if (isInfeasible || isStale) {
    return (
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
          <div className="eyebrow">Recommendation</div>
          <span className="stamp border-[#e7d9ae] bg-[#fbf7ea] text-[#7a5c14]">Action required</span>
        </div>
        <div className="p-4">
          <h3 className="font-serif text-xl font-bold tracking-tight text-ink">
            {isStale ? "Recommendation needs recomputing" : "No feasible recommendation"}
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-soft">
            {blockedReason || "No eligible quote currently covers the full requirement."}
          </p>
          <div className="mt-3 rounded-lg border border-[#e7d9ae] bg-[#fbf7ea] p-3 text-xs text-[#5c4a10]">
            {plan.totalQty > 0
              ? `${plan.totalQty} of ${need.qty} units meet the current rules, but ReliefGrid will not propose an incomplete award.`
              : `None of the ${need.qty} required units are covered by an eligible quote.`}
            {" "}Clarify or update the quotes, then recompute.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
        <div className="eyebrow">Recommendation</div>
        <span key={isApproved ? "approved" : "proposed"} className={`stamp ${isApproved ? "seal-in border-ledger bg-[#eaf2ed] text-ledger" : "border-[#e7d9ae] bg-[#fbf7ea] text-[#7a5c14]"}`}>
          {isApproved ? "Approved" : "Proposed"}
        </span>
      </div>

      <div className="p-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-hairline bg-paper p-3">
            <div className="eyebrow">Coverage</div>
            <div className="mt-1 text-lg font-bold tabular-nums">{plan.totalQty} units</div>
            <div className="text-xs text-soft">of {need.qty}</div>
          </div>
          <div className="rounded-lg border border-hairline bg-paper p-3">
            <div className="eyebrow">Cost</div>
            <div className="mt-1 text-lg font-bold tabular-nums">{formatCents(plan.totalCostCents)}</div>
            <div className="text-xs text-soft">of {formatCents(need.budgetCents)}</div>
          </div>
          <div className="rounded-lg border border-hairline bg-paper p-3">
            <div className="eyebrow">Feasible</div>
            <div className="mt-1 text-lg font-bold text-ledger">Yes</div>
            <div className="text-xs text-soft">Full coverage</div>
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
              {plan.lines?.map((line: any) => (
                <tr key={line._id} className="bg-sheet">
                  <td className="px-3 py-2 font-medium">{line.supplier?.name ?? line.supplierId.slice(0, 8)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{line.qty}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCents(line.costCents)}</td>
                  <td className="px-3 py-2 text-xs text-soft">{friendlyReason(line.reason)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {plan.decisionTrace && includeTrace ? (
          <details className="mt-3 rounded-lg border border-hairline bg-paper p-3">
            <summary className="cursor-pointer text-xs font-semibold text-ink">Technical trace</summary>
            <pre className="mt-2 whitespace-pre-wrap text-[11px] tabular-nums leading-relaxed text-soft">{plan.decisionTrace}</pre>
          </details>
        ) : null}

        <div className="mt-3 text-[11px] leading-relaxed text-soft">
          Deterministic code applies quantity, deadline, budget, confidence, and evidence rules to the extracted quote. A person must approve the result.
        </div>
      </div>
    </div>
  );
}
