import { formatDate, formatCents, displayApprover } from "../lib/format";

export function AuditReceipt({ need, plan }: any) {
  if (!plan || !need) {
    return (
      <div className="card p-4">
        <div className="eyebrow">Decision summary</div>
        <div className="mt-2 text-sm text-soft">A redacted decision record appears after an allocation exists.</div>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-hairline px-4 py-3">
        <div className="eyebrow">Decision summary</div>
        <div className="mt-0.5 text-[11px] tabular-nums text-soft">Authenticated workspace record, supplier emails withheld</div>
      </div>
      <div className="space-y-3 p-4 text-sm">
        <div className="flex justify-between gap-3">
          <span className="text-soft">Requested</span>
          <span className="text-right font-medium">{need.item}, {need.qty} units</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-soft">Budget</span>
          <span className="tabular-nums">{formatCents(need.budgetCents)}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-soft">Certification</span>
          <span>{need.certRequired}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-soft">Offers received</span>
          <span>{plan.lines?.length ?? 0} selected, deterministic trace stored</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-soft">Total cost</span>
          <span className="font-bold tabular-nums">{formatCents(plan.totalCostCents)}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-soft">Approver</span>
          <span className="tabular-nums">{displayApprover(plan.approval?.approvedBy)}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-soft">Created</span>
          <span className="tabular-nums">{formatDate(plan.createdAt)}</span>
        </div>

        <div className="border-t border-hairline pt-3 text-[11px] leading-relaxed text-soft">
          Selection criteria: deadline ≤ {new Date(need.deadlineAt).toLocaleTimeString()}, cert = {need.certRequired}, confidence ≥ 0.75, minimal total cost. Synthetic demo data never triggers supplier notices.
        </div>

        <div className="flex gap-2">
          <a href={need ? `/report?needId=${encodeURIComponent(String(need._id))}` : undefined} target="_blank" rel="noreferrer" className="w-full rounded-lg bg-ledger py-2 text-center text-xs font-medium text-white hover:bg-ledger-deep">
            View full report
          </a>
          <button onClick={() => window.print()} className="w-full rounded-lg border border-hairline bg-sheet py-2 text-xs font-medium text-ink hover:bg-paper">
            Print receipt
          </button>
        </div>
      </div>
    </div>
  );
}
