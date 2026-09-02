export type AllocInput = {
  offerId: string;
  supplierId: string;
  supplierName: string;
  qty: number;
  unitPriceCents: number;
  arrivalAt: number;
  certStatus: string;
  confidence: number;
};

export type AllocationResult = {
  selected: AllocInput[];
  rejected: Array<AllocInput & { reason: string }>;
  totalQty: number;
  totalCostCents: number;
  feasible: boolean;
  trace: string;
};

export function allocateOffers(
  offers: AllocInput[],
  need: { qty: number; budgetCents: number; deadlineAt: number; certRequired?: string; partialAllowed: boolean },
): AllocationResult {
  const rejected: Array<AllocInput & { reason: string }> = [];
  const eligible: AllocInput[] = [];

  for (const o of offers) {
    if (o.arrivalAt > need.deadlineAt) {
      rejected.push({ ...o, reason: `Late: arrives ${new Date(o.arrivalAt).toLocaleString()} after deadline ${new Date(need.deadlineAt).toLocaleString()}` });
      continue;
    }
    if (need.certRequired && o.certStatus !== "verified") {
      rejected.push({ ...o, reason: `Cert unverified: requires ${need.certRequired}, got ${o.certStatus}` });
      continue;
    }
    if (o.confidence < 0.6) {
      rejected.push({ ...o, reason: `Low confidence ${o.confidence.toFixed(2)} — needs review` });
      continue;
    }
    if (o.qty <= 0 || o.unitPriceCents <= 0) {
      rejected.push({ ...o, reason: "Invalid qty or price" });
      continue;
    }
    eligible.push(o);
  }

  // Sort by unit price then arrival
  eligible.sort((a, b) => a.unitPriceCents - b.unitPriceCents || a.arrivalAt - b.arrivalAt);

  // Greedy cheapest feasible covering
  let totalQty = 0;
  let totalCost = 0;
  const selected: AllocInput[] = [];
  const notSelected: AllocInput[] = [];

  for (const o of eligible) {
    if (totalQty >= need.qty) {
      notSelected.push(o);
      continue;
    }
    // Check if adding this would exceed budget if we fulfill fully
    const needed = need.qty - totalQty;
    const takeQty = Math.min(o.qty, needed);
    const cost = takeQty * o.unitPriceCents;
    if (totalCost + cost > need.budgetCents) {
      // Try partial if allowed and cheaper overall? For MVP, reject if over budget
      // But allow partial consumption: if we can take fewer to stay in budget, do so
      // For simplicity, reject this offer if it exceeds budget
      rejected.push({ ...o, reason: `Over budget: ${totalCost + cost} > ${need.budgetCents} cents` });
      continue;
    }
    // If offer larger than needed, we only allocate needed portion
    // Clone with adjusted qty for allocation
    const allocated = takeQty === o.qty ? o : { ...o, qty: takeQty };
    selected.push(allocated);
    totalQty += takeQty;
    totalCost += cost;
    // If original had extra beyond needed, the remainder is not needed
    if (takeQty < o.qty) {
      // The offer is partially used — trace that
    }
  }

  // Remaining eligible not used -> rejected as not needed
  for (const o of notSelected) {
    rejected.push({ ...o, reason: "Not needed: cheaper feasible cover already found" });
  }

  // Also any eligible that wasn't iterated because of budget etc already in rejected

  const feasible = totalQty >= need.qty || (need.partialAllowed && totalQty > 0);
  // If not feasible and partial not allowed, we should consider no selection?
  // For strict non-partial, if not enough qty, mark not feasible
  if (!need.partialAllowed && totalQty < need.qty) {
    // Move selected to rejected? Keep selected but mark infeasible
  }

  const trace = [
    `Need: ${need.qty} units, deadline ${new Date(need.deadlineAt).toISOString()}, budget $${(need.budgetCents / 100).toFixed(2)}, cert=${need.certRequired ?? "none"}`,
    `Eligible: ${eligible.length}, Rejected: ${rejected.length}`,
    `Selected ${selected.length} offers totalling ${totalQty} units for $${(totalCost / 100).toFixed(2)}`,
    ...rejected.map((r) => `Rejected ${r.supplierName}: ${r.reason}`),
  ].join("\n");

  return {
    selected,
    rejected,
    totalQty,
    totalCostCents: totalCost,
    feasible,
    trace,
  };
}
