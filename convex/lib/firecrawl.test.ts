import { describe, expect, it } from "vitest";
import { resolveFirecrawl } from "./firecrawl";

describe("resolveFirecrawl", () => {
  it("resolves the key when present", () => {
    expect(resolveFirecrawl({ FIRECRAWL_API_KEY: "fc-test" }).apiKey).toBe("fc-test");
  });

  it("is null-keyed without configuration", () => {
    expect(resolveFirecrawl({}).apiKey).toBeNull();
  });
});
