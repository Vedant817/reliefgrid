import { describe, expect, it } from "vitest";
import { matchNeedsByKeywords } from "./matchNeeds";

describe("matchNeedsByKeywords", () => {
  it("matches a multi-item email to 2 needs", () => {
    const needs = [
      { _id: "needA", item: "Portable Water Filters" },
      { _id: "needB", item: "Solar Blankets" },
    ];
    const body =
      "Hello, we can supply 100 portable water filters at $10 each and 50 solar blankets ready tomorrow.";
    expect(matchNeedsByKeywords(body, needs).sort()).toEqual(["needA", "needB"]);
  });

  it("returns [] when nothing matches", () => {
    const needs = [{ _id: "needA", item: "Portable Water Filters" }];
    expect(matchNeedsByKeywords("We deliver fresh sandwiches daily.", needs)).toEqual([]);
  });

  it("ignores short words", () => {
    const needs = [{ _id: "needOil", item: "Oil" }];
    // "oil" is only 3 chars so it is never significant, even on exact mention.
    expect(matchNeedsByKeywords("We can supply oil and gas.", needs)).toEqual([]);
  });

  it("normalizes case and punctuation", () => {
    const needs = [{ _id: "needA", item: "Water Filters" }];
    expect(matchNeedsByKeywords("WATER-FILTERS!!! available now.", needs)).toEqual(["needA"]);
  });

  it("ignores stopwords", () => {
    const needs = [{ _id: "needA", item: "With That" }];
    // Both words are stopwords, so no significant overlap remains.
    expect(matchNeedsByKeywords("with that please", needs)).toEqual([]);
  });
});
