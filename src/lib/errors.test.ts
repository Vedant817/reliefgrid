import { describe, expect, test } from "vitest";
import { userFacingError } from "./errors";

describe("userFacingError", () => {
  test("removes Convex transport and stack-trace details", () => {
    const error = new Error(
      "[CONVEX M(suppliers:upsertSupplier)] [Request ID: abc] Server Error Uncaught Error: Enter a deliverable supplier email address\n    at handler (../convex/suppliers.ts:42:7)",
    );
    expect(userFacingError(error, "Could not add supplier")).toBe("Enter a deliverable supplier email address");
  });

  test("uses a short fallback for unknown failures", () => {
    expect(userFacingError(null, "Could not add supplier")).toBe("Could not add supplier");
    expect(userFacingError(new Error("internal callback pool token mismatch"), "Could not send request"))
      .toBe("Could not send request");
  });
});
