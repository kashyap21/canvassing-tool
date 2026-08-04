import { describe, expect, it } from "vitest";
import { rankOf, splitMatch, suggestStreets, uniqueStreets } from "./streetSuggestions";

// The DB returns distinct streets alphabetically, so tests mirror that order.
const STREETS = [
  "Birch Avenue",
  "Kingsmaple Row",
  "Maple Court",
  "Maple Street",
  "Old Maple Lane",
  "Queen Street West",
];

describe("rankOf", () => {
  it("ranks a leading match first", () => {
    expect(rankOf("Maple Street", "map")).toBe(0);
  });

  it("ranks a later word above a mid-word match", () => {
    expect(rankOf("Old Maple Lane", "map")).toBe(1);
    expect(rankOf("Kingsmaple Row", "map")).toBe(2);
  });

  it("matches across street-suffix spellings", () => {
    expect(rankOf("Maple St", "maple street")).toBe(3);
    expect(rankOf("Maple Street", "maple st")).toBe(0); // plain prefix, no folding needed
  });

  it("returns null when nothing matches", () => {
    expect(rankOf("Birch Avenue", "map")).toBeNull();
  });
});

describe("suggestStreets", () => {
  it("orders leading matches before later-word and mid-word ones", () => {
    expect(suggestStreets(STREETS, "map")).toEqual([
      "Maple Court",
      "Maple Street",
      "Old Maple Lane",
      "Kingsmaple Row",
    ]);
  });

  it("ignores case and extra whitespace in what was typed", () => {
    expect(suggestStreets(STREETS, "  QUEEN   street ")).toEqual(["Queen Street West"]);
  });

  it("suggests known streets before anything is typed", () => {
    expect(suggestStreets(STREETS, "", 3)).toEqual(["Birch Avenue", "Kingsmaple Row", "Maple Court"]);
  });

  it("stops suggesting once the typed value is the only match", () => {
    expect(suggestStreets(STREETS, "Queen Street West")).toEqual([]);
    // Still worth showing while a longer street shares the prefix.
    expect(suggestStreets(STREETS, "Queen Street")).toEqual(["Queen Street West"]);
  });

  it("caps the list at the limit", () => {
    expect(suggestStreets(STREETS, "", 2)).toHaveLength(2);
  });

  it("returns nothing for an unknown street and never invents one", () => {
    expect(suggestStreets(STREETS, "Zephyr")).toEqual([]);
  });

  it("tolerates an empty or missing street list", () => {
    expect(suggestStreets([], "map")).toEqual([]);
    expect(suggestStreets(undefined, "map")).toEqual([]);
  });
});

describe("uniqueStreets", () => {
  it("collapses case and whitespace variants, keeping the first spelling", () => {
    expect(uniqueStreets(["Maple Street", "maple  street", " MAPLE STREET ", "Birch Avenue"])).toEqual([
      "Maple Street",
      "Birch Avenue",
    ]);
  });

  it("drops blank entries", () => {
    expect(uniqueStreets(["", "   ", null, undefined, "Birch Avenue"])).toEqual(["Birch Avenue"]);
  });
});

describe("splitMatch", () => {
  it("splits around the typed run", () => {
    expect(splitMatch("Old Maple Lane", "map")).toEqual(["Old ", "Map", "le Lane"]);
  });

  it("returns the whole street when there is no literal match", () => {
    expect(splitMatch("Maple St", "maple street")).toEqual(["Maple St", "", ""]);
    expect(splitMatch("Maple St", "")).toEqual(["Maple St", "", ""]);
  });
});
