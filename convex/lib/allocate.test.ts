import { describe, expect, it } from "vitest";
import { allocateOffers, type AllocInput } from "./allocate";

const need = { qty: 10, budgetCents: 10000, deadlineAt: Date.now() + 3600000, certRequired: "NSF/ANSI 53", partialAllowed: true };

function offer(overrides: Partial<AllocInput> = {}): AllocInput {
  return {
    offerId: "offer-1", supplierId: "supplier-1", supplierName: "Supplier", qty: 10,
    unitPriceCents: 500, arrivalAt: Date.now() + 1000, certStatus: "verified", confidence: 0.95,
    fieldEvidence: {
      qty: { confidence: 0.98 }, price: { confidence: 0.97 },
      arrival: { confidence: 0.9 }, cert: { confidence: 0.95 },
    },
    ...overrides,
  };
}

describe("allocateOffers abstention", () => {
  it("excludes an offer with a low-confidence required field", () => {
    const ambiguous = offer({ fieldEvidence: { qty: { confidence: 0.2 }, price: { confidence: 0.97 }, arrival: { confidence: 0.9 }, cert: { confidence: 0.95 } } });
    const result = allocateOffers([ambiguous], need);
    expect(result.selected).toEqual([]);
    expect(result.rejected[0].reason).toContain("low-confidence qty");
  });

  it("selects an offer whose required fields are supported", () => {
    const result = allocateOffers([offer()], need);
    expect(result.totalQty).toBe(10);
    expect(result.selected).toHaveLength(1);
  });

  it("does not require certification evidence when the need has no certification constraint", () => {
    const noCertificationNeed = { ...need, certRequired: undefined };
    const result = allocateOffers([
      offer({
        certStatus: "unverified",
        fieldEvidence: {
          qty: { confidence: 0.99 },
          price: { confidence: 0.99 },
          arrival: { confidence: 0.99 },
          cert: { confidence: 1 },
        },
      }),
    ], noCertificationNeed);
    expect(result.totalQty).toBe(10);
    expect(result.selected).toHaveLength(1);
  });

  it("evaluates overrides without mutating its inputs", () => {
    const late = offer({ arrivalAt: need.deadlineAt + 16 * 3600000, unitPriceCents: 300 });
    const original = JSON.stringify(late);
    expect(allocateOffers([late], need).selected).toHaveLength(0);
    expect(allocateOffers([late], { ...need, deadlineAt: need.deadlineAt + 16 * 3600000 }).selected).toHaveLength(1);
    expect(JSON.stringify(late)).toBe(original);
  });
});
