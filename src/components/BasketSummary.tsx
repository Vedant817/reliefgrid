import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { formatCents } from "../lib/format";

// Basket view for multi-item requests: how many of the incident's line
// items are fully covered and at what planned cost. Hidden for single-item
// requests, where the stat cards already say it.
export function BasketSummary({ incidentId }: { incidentId?: any }) {
  const needs: any = useQuery(api.needs.listNeedsByIncident, incidentId ? { incidentId } : "skip") ?? [];
  const plans: any = useQuery(api.allocations.listPlansByIncident, incidentId ? { incidentId } : "skip") ?? [];
  if (!incidentId || needs.length < 2) return null;

  const covered = plans.filter((p: any) => p.totalQty >= p.qty).length;
  const plannedCost = plans.reduce((sum: number, p: any) => sum + (p.totalCostCents ?? 0), 0);
  const budget = needs.reduce((sum: number, n: any) => sum + (n.budgetCents ?? 0), 0);

  return (
    <div className="mx-auto max-w-[1400px] px-4 pt-4 lg:px-6">
      <div className="card flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
        <span className="eyebrow">Basket</span>
        <span className="font-serif text-lg font-bold tabular-nums">{covered} of {needs.length} items fully covered</span>
        <span className="text-sm tabular-nums text-soft">{formatCents(plannedCost)} planned of {formatCents(budget)}</span>
      </div>
    </div>
  );
}
