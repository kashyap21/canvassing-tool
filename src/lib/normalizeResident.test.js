import { describe, it, expect } from "vitest";
import { normalizePhone, normalizeResidentPayload } from "./normalizeResident";

describe("normalizePhone", () => {
  it("keeps an already-dashed number as it is", () => {
    expect(normalizePhone("905-123-4567")).toBe("905-123-4567");
  });

  it("converts the display formats a canvasser might type", () => {
    expect(normalizePhone("(905) 123-4567")).toBe("905-123-4567");
    expect(normalizePhone("9051234567")).toBe("905-123-4567");
    expect(normalizePhone("905 123 4567")).toBe("905-123-4567");
    expect(normalizePhone("905.123.4567")).toBe("905-123-4567");
  });

  it("drops a leading country code", () => {
    expect(normalizePhone("+19051234567")).toBe("905-123-4567");
    expect(normalizePhone("1 (905) 123-4567")).toBe("905-123-4567");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizePhone("  9051234567  ")).toBe("905-123-4567");
  });

  it("leaves N/A alone", () => {
    expect(normalizePhone("N/A")).toBe("N/A");
  });

  it("leaves an empty value empty", () => {
    expect(normalizePhone("")).toBe("");
    expect(normalizePhone("   ")).toBe("");
  });

  it("does not invent an area code for a seven-digit number", () => {
    expect(normalizePhone("979-1401")).toBe("979-1401");
    expect(normalizePhone("9791401")).toBe("9791401");
  });

  it("leaves anything longer than a plain number as typed", () => {
    expect(normalizePhone("905-123-4567 ext 12")).toBe("905-123-4567 ext 12");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+44 20 7946 0958");
  });

  it("leaves values containing letters as typed", () => {
    expect(normalizePhone("call 9051234567")).toBe("call 9051234567");
    expect(normalizePhone("905-CALL-NOW")).toBe("905-CALL-NOW");
  });

  it("passes non-strings through untouched", () => {
    expect(normalizePhone(null)).toBe(null);
    expect(normalizePhone(undefined)).toBe(undefined);
  });
});

describe("normalizeResidentPayload", () => {
  const base = {
    street_number: " 12 ",
    street_name: "  King  St ",
    unit_no: "",
    first_name: " Ada ",
    last_name: "Lovelace",
    cell_number: "(905) 123-4567",
    email: " ada@example.com ",
    comments: "",
  };

  it("formats the phone number while trimming the rest", () => {
    const out = normalizeResidentPayload(base);
    expect(out.cell_number).toBe("905-123-4567");
    expect(out.street_name).toBe("King St");
    expect(out.first_name).toBe("Ada");
    expect(out.email).toBe("ada@example.com");
  });

  it("does not disturb an N/A row", () => {
    const out = normalizeResidentPayload({ ...base, cell_number: "N/A" });
    expect(out.cell_number).toBe("N/A");
  });
});
