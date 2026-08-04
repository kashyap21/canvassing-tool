import { describe, expect, it } from "vitest";
import {
  addressKey,
  findAddressMatches,
  findDuplicateGroups,
  mergeResidents,
  normalizeStreetName,
  normalizeUnit,
  summarizeStreets,
} from "./duplicates";

let nextId = 1;
function resident(overrides = {}) {
  return {
    id: nextId++,
    street_number: "12",
    street_name: "Maple Street",
    unit_no: "",
    first_name: "",
    last_name: "",
    cell_number: "",
    email: "",
    supporter: "unknown",
    number_of_votes: 1,
    lawn_sign: false,
    newsletter_consent: false,
    comments: "",
    created_at: "2026-07-01T10:00:00Z",
    ...overrides,
  };
}

describe("normalizeStreetName", () => {
  it("collapses common abbreviations and punctuation", () => {
    expect(normalizeStreetName("Maple St.")).toBe("maple street");
    expect(normalizeStreetName("  maple   STREET ")).toBe("maple street");
    expect(normalizeStreetName("Oak Ave N")).toBe("oak avenue north");
  });

  it("keeps a leading 'St' as part of the name", () => {
    expect(normalizeStreetName("St Clair")).toBe("st clair");
  });
});

describe("normalizeUnit", () => {
  it("treats the usual ways of writing a unit as one value", () => {
    expect(normalizeUnit("Apt 3")).toBe("3");
    expect(normalizeUnit("#3")).toBe("3");
    expect(normalizeUnit(" unit 03 ")).toBe("3");
    expect(normalizeUnit("N/A")).toBe("");
  });
});

describe("addressKey", () => {
  it("matches spelling variants of the same door", () => {
    expect(addressKey(resident({ street_number: "012", street_name: "Maple St" }))).toBe(
      addressKey(resident({ street_number: "12", street_name: "maple street" })),
    );
  });

  it("separates different units in one building", () => {
    expect(addressKey(resident({ unit_no: "1" }))).not.toBe(addressKey(resident({ unit_no: "2" })));
  });

  it("is blank when the address is incomplete", () => {
    expect(addressKey(resident({ street_name: "" }))).toBe("");
  });
});

describe("findDuplicateGroups", () => {
  it("flags a repeated name at one address as a same-name duplicate", () => {
    const groups = findDuplicateGroups([
      resident({ first_name: "John", last_name: "Smith" }),
      resident({ street_name: "Maple St", first_name: "john", last_name: "SMITH" }),
      resident({ street_number: "14", first_name: "Ann", last_name: "Lee" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe("same-name");
    expect(groups[0].rows).toHaveLength(2);
  });

  it("reports two different people at one address as same-address only", () => {
    const groups = findDuplicateGroups([
      resident({ first_name: "John", last_name: "Smith" }),
      resident({ first_name: "Ann", last_name: "Smith" }),
    ]);
    expect(groups[0].kind).toBe("same-address");
    expect(groups[0].repeatedNameIds).toEqual([]);
  });

  it("suggests keeping the entry with the most information", () => {
    const sparse = resident();
    const full = resident({ first_name: "John", cell_number: "555-1234", supporter: "yes" });
    const groups = findDuplicateGroups([sparse, full]);
    expect(groups[0].suggestedKeepId).toBe(full.id);
  });
});

describe("mergeResidents", () => {
  it("keeps the chosen row and tops up its blank fields", () => {
    const keep = resident({ first_name: "John", created_at: "2026-07-01T10:00:00Z" });
    const other = resident({
      first_name: "Johnny",
      cell_number: "555-1234",
      supporter: "yes",
      lawn_sign: true,
      comments: "Back door",
      created_at: "2026-07-02T10:00:00Z",
    });

    const { keepId, payload, removeIds } = mergeResidents([keep, other], keep.id);

    expect(keepId).toBe(keep.id);
    expect(removeIds).toEqual([other.id]);
    expect(payload.first_name).toBe("John"); // the kept row wins where it has a value
    expect(payload.cell_number).toBe("555-1234"); // blanks filled from the other
    expect(payload.supporter).toBe("yes");
    expect(payload.lawn_sign).toBe(true);
    expect(payload.comments).toBe("Back door");
  });

  it("does not double-count votes", () => {
    const { payload } = mergeResidents(
      [resident({ number_of_votes: 2 }), resident({ number_of_votes: 3 })],
      null,
    );
    expect(payload.number_of_votes).toBe(3);
  });

  it("prefers a real value over N/A but keeps N/A when there is nothing else", () => {
    const naRow = resident({ first_name: "N/A", last_name: "N/A", cell_number: "N/A" });
    const named = resident({ first_name: "Ann", last_name: "", cell_number: "" });

    const merged = mergeResidents([naRow, named], naRow.id).payload;
    expect(merged.first_name).toBe("Ann");
    expect(merged.cell_number).toBe("N/A");
  });

  it("joins distinct comments instead of repeating them", () => {
    const { payload } = mergeResidents(
      [resident({ comments: "Not home" }), resident({ comments: "Not home" }), resident({ comments: "Call back" })],
      null,
    );
    expect(payload.comments).toBe("Not home\nCall back");
  });
});

describe("findAddressMatches", () => {
  it("splits exact-door matches from other units in the building", () => {
    const rows = [
      resident({ unit_no: "" }),
      resident({ unit_no: "2" }),
      resident({ street_number: "14" }),
    ];
    const { exact, otherUnits } = findAddressMatches(rows, {
      street_number: "12",
      street_name: "Maple St",
      unit_no: "",
    });
    expect(exact).toHaveLength(1);
    expect(otherUnits).toHaveLength(1);
  });

  it("returns nothing for an incomplete address", () => {
    expect(findAddressMatches([resident()], { street_number: "12", street_name: "" }).exact).toEqual([]);
  });
});

describe("summarizeStreets", () => {
  it("lists the rarest street names first with their entry counts", () => {
    const streets = summarizeStreets([
      resident({ street_name: "Maple Street" }),
      resident({ street_name: "Maple St" }),
      resident({ street_number: "907", street_name: "Muslim" }),
    ]);
    expect(streets[0]).toMatchObject({ label: "Muslim", count: 1 });
    expect(streets[0].samples).toEqual(["907 Muslim"]);
    expect(streets[1].count).toBe(2); // both spellings counted as one street
    expect(streets[1].variants).toEqual(["Maple St", "Maple Street"]);
  });
});
