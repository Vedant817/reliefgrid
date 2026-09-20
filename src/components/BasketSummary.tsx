import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { formatCents } from "../lib/format";

// Basket view for multi-item requests: how many of the incident's line
// items are fully covered and at what planned cost. Hidden for single-item
// requests, where the stat cards already say it.
export function BasketSummary({ incidentId }: { incidentId?: any }) {
  const coverage: any = useQuery(api.allocations.getBasketCoverage, incidentId ? { incidentId } : "skip");
  const needs: any = useQuery(api.needs.listNeedsByIncident, incidentId ? { incidentId } : "skip") ?? [];
  const needsCount = coverage?.totals?.needs ?? needs.length;
  if (!incidentId || needsCount < 2) return null;
  if (!coverage) return null;

  const covered = coverage.totals.fullyCovered;
  const plannedCost = coverage.totals.totalCostCents;
  const budget = needs.reduce((sum: number, n: any) => sum + (n.budgetCents ?? 0), 0);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[10px] border border-hairline bg-sheet px-4 py-3">
      <span className="eyebrow">Basket</span>
      <span className="font-serif text-lg font-bold tabular-nums">{covered} of {coverage.totals.needs} items fully covered</span>
      <span className="text-sm tabular-nums text-soft">{formatCents(plannedCost)} planned of {formatCents(budget)}</span>
    </div>
  );
}
