import { formatDate, formatCents } from "../lib/format";

export function AuditReceipt({ need, plan }: any) {
  if (!plan || !need) {
    return (
      <div className="rounded-2xl bg-[#111827] border border-[#1e2d4a] p-4">
        <div className="text-xs tracking-[0.14em] uppercase text-slate-400">Decision packet</div>
        <div className="text-sm text-slate-500 mt-2">A redacted decision record appears after an allocation exists.</div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-[#111827] border border-[#1e2d4a] overflow-hidden">
      <div className="px-4 py-3 border-b border-[#1e2d4a]">
        <div className="text-xs tracking-[0.14em] uppercase text-slate-400">Decision packet — redacted</div>
        <div className="text-[11px] mono text-slate-500">Authenticated workspace record · no supplier emails exposed</div>
      </div>
      <div className="p-4 space-y-3 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-400">Requested</span>
          <span className="font-medium">{need.item} · {need.qty} units</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Budget</span>
          <span className="mono">{formatCents(need.budgetCents)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Certification</span>
          <span>{need.certRequired}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Offers received</span>
          <span>{plan.lines?.length ?? 0} selected · deterministic trace stored</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Total cost</span>
          <span className="font-bold">{formatCents(plan.totalCostCents)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Approver</span>
          <span className="mono">{plan.approval?.approvedBy ?? "Pending approval"}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Created</span>
          <span className="mono">{formatDate(plan.createdAt)}</span>
        </div>

        <div className="pt-3 border-t border-[#1e2d4a] text-[11px] leading-relaxed text-slate-500">
          Selection criteria: deadline ≤ {new Date(need.deadlineAt).toLocaleTimeString()}, cert = {need.certRequired}, confidence ≥ 0.75, minimal total cost. Synthetic demo data never triggers supplier notices.
        </div>

        <div className="flex gap-2">
          <button onClick={() => window.print()} className="w-full py-2 rounded-xl bg-white text-[#0a0e1a] text-xs font-semibold">
            Print receipt
          </button>
        </div>
      </div>
    </div>
  );
}
