export function allocationInputHash(
  need: { qty: number; budgetCents: number; deadlineAt: number; certRequired?: string; partialAllowed: boolean },
  offers: Array<{ offerId: unknown; qty: number; unitPriceCents: number; arrivalAt?: number; certStatus: string; confidence: number; fieldEvidence?: unknown; [key: string]: unknown }>,
) {
  return JSON.stringify({
    need: {
      qty: need.qty,
      budgetCents: need.budgetCents,
      deadlineAt: need.deadlineAt,
      certRequired: need.certRequired ?? null,
      partialAllowed: need.partialAllowed,
    },
    offers: offers
      .map((offer) => [String(offer.offerId), offer.qty, offer.unitPriceCents, offer.arrivalAt ?? null, offer.certStatus, offer.confidence, offer.fieldEvidence ?? null])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  });
}
