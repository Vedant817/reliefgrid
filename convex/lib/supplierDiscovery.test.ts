import { describe, expect, test } from "vitest";
import { extractPublicContactEmail, supplierRegionLabel } from "./supplierDiscovery";

describe("supplier discovery normalization", () => {
  test("prefers a public sales mailbox", () => {
    expect(extractPublicContactEmail("CEO jane@vendor.com. Quotes: sales@vendor.com"))
      .toBe("sales@vendor.com");
  });

  test("rejects reserved and no-reply mailboxes", () => {
    expect(extractPublicContactEmail("noreply@vendor.com support@example.org")).toBeUndefined();
  });

  test("uses a source hostname as a transparent service-area label", () => {
    expect(supplierRegionLabel("https://www.vendor.co.in/catalog")).toBe("vendor.co.in");
  });
});
