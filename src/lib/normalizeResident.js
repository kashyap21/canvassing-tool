const TRIM_FIELDS = [
  "street_number",
  "street_name",
  "unit_no",
  "first_name",
  "last_name",
  "cell_number",
  "email",
  "comments",
];

const SPACE_NORMALIZED_FIELDS = ["street_number", "street_name", "unit_no"];

function normalizeText(value, collapseSpaces = false) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return collapseSpaces ? trimmed.replace(/\s+/g, " ") : trimmed;
}

export function normalizeStreetPart(value) {
  return normalizeText(value, true) || "";
}

/**
 * Phone numbers are stored one way: 555-123-4567. That reads cleanly on screen
 * and is the format the robocall diallers import without extra massaging, so
 * whatever the canvasser types — (555) 123-4567, +1 555 123 4567, 5551234567 —
 * lands in the database the same shape.
 *
 * Anything that isn't a plain North American number is left exactly as typed
 * rather than forced into a shape it doesn't fit: "N/A", a seven-digit number
 * with no area code, an extension, an international number. Guessing at those
 * would turn a recoverable entry into a wrong one.
 */
export function normalizePhone(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();

  // Letters mean a note or a vanity number ("call after 6", "555-CALL-NOW").
  // Digits pulled out of those don't stand alone as a phone number.
  if (/[A-Za-z]/.test(trimmed)) return trimmed;

  const digits = trimmed.replace(/\D/g, "");
  // A leading country code of 1 is dropped: +1 555 123 4567 and 5551234567 are
  // the same number, and the dialler adds the 1 back itself.
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length !== 10) return trimmed;

  return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
}

export function normalizeResidentPayload(values) {
  const payload = { ...values };

  for (const field of TRIM_FIELDS) {
    payload[field] = normalizeText(payload[field], SPACE_NORMALIZED_FIELDS.includes(field));
  }
  payload.cell_number = normalizePhone(payload.cell_number);

  return payload;
}
