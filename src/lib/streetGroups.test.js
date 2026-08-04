import { describe, expect, it } from "vitest";
import { editDistance, findStreetClusters, selectionSummary } from "./streetGroups";

// Shaped like summarizeStreets() output: canonical key, display label, count, ids.
let nextId = 1;
function street(label, key, count) {
  return {
    key,
    label,
    count,
    ids: Array.from({ length: count }, () => nextId++),
    variants: [label],
    samples: [],
  };
}

const UPPER_OTTAWA = street("Upper Ottawa Street", "upper ottawa street", 120);
const MAPLE = street("Maple Street", "maple street", 40);

describe("editDistance", () => {
  it("counts single-character edits", () => {
    expect(editDistance("ottawa", "ottowa")).toBe(1); // substitution
    expect(editDistance("ottawa", "ottawaa")).toBe(1); // insertion
    expect(editDistance("ottawa", "ottaw")).toBe(1); // deletion
    expect(editDistance("ottawa", "ottawa")).toBe(0);
  });

  it("reports cutoff + 1 rather than the true distance once past the cutoff", () => {
    expect(editDistance("maple street", "queen boulevard", 2)).toBe(3);
    expect(editDistance("abc", "xyz", 1)).toBe(2);
  });

  it("respects a widened cutoff", () => {
    expect(editDistance("ottawa", "ottwaa", 2)).toBe(2); // transposition = 2 edits
  });
});

describe("findStreetClusters", () => {
  it("folds a rare typo into the common street it resembles", () => {
    const clusters = findStreetClusters([UPPER_OTTAWA, street("Uppr Ottawa Street", "uppr ottawa street", 1)]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].target.label).toBe("Upper Ottawa Street");
    expect(clusters[0].variants.map((v) => v.label)).toEqual(["Uppr Ottawa Street"]);
    expect(clusters[0].variants[0].reason).toBe("typo");
    expect(clusters[0].entryCount).toBe(1);
    expect(clusters[0].keys).toContain("upper ottawa street");
  });

  it("catches a scan that stopped early", () => {
    const clusters = findStreetClusters([UPPER_OTTAWA, street("Upp", "upp", 1)]);
    expect(clusters[0].variants[0]).toMatchObject({ label: "Upp", reason: "truncated" });
  });

  it("leaves two established streets alone even when they differ by one letter", () => {
    // Both are real streets with real entries — neither is a mis-scan.
    expect(findStreetClusters([street("Oak Street", "oak street", 40), street("Oat Street", "oat street", 35)]))
      .toEqual([]);
  });

  it("declines to guess when two common streets fit equally well", () => {
    const clusters = findStreetClusters([
      street("Mayfield Road", "mayfield road", 30),
      street("Maybrook Road", "maybrook road", 30),
      street("May", "may", 1),
    ]);
    expect(clusters).toEqual([]);
  });

  it("prefers the closer match over the more common one", () => {
    const clusters = findStreetClusters([
      street("Ottawa Street", "ottawa street", 200),
      street("Ottowa Street", "ottowa street", 5), // one edit away from the typo
      street("Ottowa Streat", "ottowa streat", 1),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].target.label).toBe("Ottowa Street");
  });

  it("groups several typos under one target and counts every entry", () => {
    const clusters = findStreetClusters([
      UPPER_OTTAWA,
      street("Uppr Ottawa Street", "uppr ottawa street", 1),
      street("Upper Ottowa Street", "upper ottowa street", 2),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].variants).toHaveLength(2);
    expect(clusters[0].entryCount).toBe(3);
  });

  it("orders clusters by how many entries need repairing", () => {
    const clusters = findStreetClusters([
      MAPLE,
      street("Maple Streit", "maple streit", 1),
      UPPER_OTTAWA,
      street("Uppr Ottawa Street", "uppr ottawa street", 2),
    ]);
    expect(clusters.map((c) => c.target.label)).toEqual(["Upper Ottawa Street", "Maple Street"]);
  });

  it("suggests nothing without both a rare and a common name", () => {
    expect(findStreetClusters([UPPER_OTTAWA, MAPLE])).toEqual([]);
    expect(findStreetClusters([street("A Road", "a road", 1), street("B Road", "b road", 1)])).toEqual([]);
    expect(findStreetClusters([])).toEqual([]);
    expect(findStreetClusters(undefined)).toEqual([]);
  });
});

describe("selectionSummary", () => {
  const streets = [UPPER_OTTAWA, MAPLE, street("Uppr Ottawa Street", "uppr ottawa street", 2)];

  it("totals the streets and entries a rename would touch", () => {
    const summary = selectionSummary(streets, ["upper ottawa street", "uppr ottawa street"]);
    expect(summary.streetCount).toBe(2);
    expect(summary.entryCount).toBe(122);
    expect(summary.ids).toHaveLength(122);
  });

  it("offers the most-used ticked spelling as the target name", () => {
    expect(selectionSummary(streets, ["uppr ottawa street", "upper ottawa street"]).suggestedName).toBe(
      "Upper Ottawa Street",
    );
  });

  it("accepts a Set and copes with an empty selection", () => {
    expect(selectionSummary(streets, new Set(["maple street"])).entryCount).toBe(40);
    expect(selectionSummary(streets, [])).toEqual({
      streetCount: 0,
      entryCount: 0,
      ids: [],
      suggestedName: "",
    });
  });
});
