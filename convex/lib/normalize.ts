export type NormalizedOffer = {
  offerId: string;
  supplierId: string;
  supplierName: string;
  qty: number;
  unitPriceCents: number;
  arrivalAt: number;
  certStatus: string;
  conditions: string[];
  confidence: number;
  totalCostCents: number;
};

export function normalizeOffer(raw: {
  _id: string;
  supplierId: string;
  supplier?: { name: string } | null;
  qty: number;
  unitPriceCents: number;
  arrivalAt: number;
  certStatus: string;
  conditions: string[];
  confidence: number;
}): NormalizedOffer {
  return {
    offerId: raw._id,
    supplierId: raw.supplierId,
    supplierName: raw.supplier?.name ?? raw.supplierId,
    qty: raw.qty,
    unitPriceCents: raw.unitPriceCents,
    arrivalAt: raw.arrivalAt,
    certStatus: raw.certStatus,
    conditions: raw.conditions,
    confidence: raw.confidence,
    totalCostCents: raw.qty * raw.unitPriceCents,
  };
}
