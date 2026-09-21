import { describe, expect, test } from "vitest";
import { ownerAccessFromIdentity, ownerMatches, requireSupplierOwner, supplierBelongsTo } from "./auth";

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

  test("uses a stable user id while recognizing legacy session-scoped owners", () => {
    const first = ownerAccessFromIdentity({
      issuer: "https://example.convex.site",
      subject: "user-123|session-new",
      tokenIdentifier: "https://example.convex.site|user-123|session-new",
    }, "user-123");

    expect(first.ownerId).toBe("user-123");
    expect(ownerMatches("user-123", first)).toBe(true);
    expect(ownerMatches("https://example.convex.site|user-123|session-old", first)).toBe(true);
    expect(ownerMatches("https://example.convex.site|user-456|session-old", first)).toBe(false);
  });
});
