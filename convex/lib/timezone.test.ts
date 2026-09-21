import { describe, expect, test } from "vitest";
import { isValidTimeZone, parseSupplierArrival } from "./timezone";

describe("supplier arrival normalization", () => {
  test("interprets a date-only promise as end-of-day in the requirement timezone", () => {
    expect(new Date(parseSupplierArrival("2026-09-24", "America/New_York")!).toISOString())
      .toBe("2026-09-25T03:59:59.999Z");
    expect(new Date(parseSupplierArrival("2026-09-24", "Asia/Kolkata")!).toISOString())
      .toBe("2026-09-24T18:29:59.999Z");
  });

  test("accepts explicit offsets and rejects ambiguous local date-times", () => {
    expect(parseSupplierArrival("2026-09-24T16:00:00-04:00", "America/New_York"))
      .toBe(Date.parse("2026-09-24T16:00:00-04:00"));
    expect(parseSupplierArrival("2026-09-24T16:00:00", "America/New_York")).toBeUndefined();
  });

  test("does not turn missing or invalid arrivals into the Unix epoch", () => {
    expect(parseSupplierArrival(null, "UTC")).toBeUndefined();
    expect(parseSupplierArrival("NEXT_WEEK", "UTC")).toBeUndefined();
    expect(parseSupplierArrival("2026-02-31", "UTC")).toBeUndefined();
    expect(isValidTimeZone("Not/A_Zone")).toBe(false);
  });
});
