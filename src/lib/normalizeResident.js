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

export function normalizeResidentPayload(values) {
  const payload = { ...values };

  for (const field of TRIM_FIELDS) {
    payload[field] = normalizeText(payload[field], SPACE_NORMALIZED_FIELDS.includes(field));
  }

  return payload;
}
