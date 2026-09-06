import { describe, expect, test } from "vitest";
import { requireSupplierOwner, supplierBelongsTo } from "./auth";

describe("supplierBelongsTo", () => {
  test("matches only the owning workspace", () => {
    expect(supplierBelongsTo(null, "owner-a")).toBe(false);
    expect(supplierBelongsTo({ ownerId: undefined }, "owner-a")).toBe(false);
    expect(supplierBelongsTo({ ownerId: "owner-a" }, "owner-a")).toBe(true);
    expect(supplierBelongsTo({ ownerId: "owner-a" }, "owner-b")).toBe(false);
  });

  test("requireSupplierOwner is exported for the chain", () => {
    expect(typeof requireSupplierOwner).toBe("function");
  });
});
