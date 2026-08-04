// Duplicate detection + merging.
//
// Paper canvassing sheets get typed in by several people (and partly by OCR),
// so the same household often lands in the table more than once with small
// spelling differences ("12 Maple St" vs "12 Maple Street"). Everything here
// works on a *normalized* address key so those variants collapse together.

import { normalizeStreetPart } from "./normalizeResident";

// Only unambiguous abbreviations. "cr" (court? crescent?) is deliberately out.
const STREET_SUFFIXES = new Map([
  ["st", "street"],
  ["str", "street"],
  ["ave", "avenue"],
  ["av", "avenue"],
  ["rd", "road"],
  ["dr", "drive"],
  ["drv", "drive"],
  ["blvd", "boulevard"],
  ["cres", "crescent"],
  ["crt", "court"],
  ["ct", "court"],
  ["pl", "place"],
  ["ln", "lane"],
  ["terr", "terrace"],
  ["ter", "terrace"],
  ["trl", "trail"],
  ["cir", "circle"],
  ["gdns", "gardens"],
  ["sq", "square"],
  ["hwy", "highway"],
  ["pkwy", "parkway"],
  ["hts", "heights"],
]);

const DIRECTIONS = new Map([
  ["n", "north"],
  ["s", "south"],
  ["e", "east"],
  ["w", "west"],
  ["ne", "northeast"],
  ["nw", "northwest"],
  ["se", "southeast"],
  ["sw", "southwest"],
]);

const UNIT_PREFIX_RE = /^(apt|apartment|unit|suite|ste|no|number|#)/;

/** "N/A" and blanks both mean "nothing was recorded". */
export function meaningful(value) {
  const text = String(value ?? "").trim();
  if (!text || text.toUpperCase() === "N/A") return "";
  return text;
}

// "12 Maple St. N" and "12 maple street north" produce the same key.
export function normalizeStreetName(value) {
  const cleaned = normalizeStreetPart(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ");
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    let last = words.length - 1;
    // A trailing direction ("maple st n") shifts the suffix one to the left.
    if (last > 0 && DIRECTIONS.has(words[last])) {
      words[last] = DIRECTIONS.get(words[last]);
      last -= 1;
    }
    // last > 0 keeps "St. Clair" (Saint) from becoming "street clair".
    if (last > 0 && STREET_SUFFIXES.has(words[last])) {
      words[last] = STREET_SUFFIXES.get(words[last]);
    }
  }
  return words.join(" ");
}

export function normalizeStreetNumber(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/^0+(?=\d)/, ""); // 007 -> 7
}

export function normalizeUnit(value) {
  const text = meaningful(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s#]/g, " ")
    .trim();
  if (!text) return "";
  return text
    .replace(UNIT_PREFIX_RE, "")
    .replace(/[^a-z0-9]/g, "")
    .replace(/^0+(?=\d)/, "");
}

/** Key that ignores unit — everything at one street address. */
export function buildingKey(row) {
  const number = normalizeStreetNumber(row?.street_number);
  const street = normalizeStreetName(row?.street_name);
  if (!number || !street) return "";
  return `${number}|${street}`;
}

/** Key including the unit — one specific door. */
export function addressKey(row) {
  const building = buildingKey(row);
  if (!building) return "";
  return `${building}|${normalizeUnit(row?.unit_no)}`;
}

export function normalizePersonName(row) {
  return [meaningful(row?.first_name), meaningful(row?.last_name)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function formatAddress(row) {
  const base = [row?.street_number, row?.street_name].filter(Boolean).join(" ").trim();
  const unit = meaningful(row?.unit_no);
  return unit ? `${base} · Unit ${unit}` : base || "(no address)";
}

const createdAt = (row) => new Date(row?.created_at || 0).getTime() || 0;
const oldestFirst = (a, b) => createdAt(a) - createdAt(b) || (a.id || 0) - (b.id || 0);

/** How many fields actually carry information — used to pre-pick what to keep. */
export function completeness(row) {
  const fields = ["first_name", "last_name", "cell_number", "email", "comments", "unit_no"];
  let score = fields.reduce((n, f) => n + (meaningful(row[f]) ? 1 : 0), 0);
  if (row.supporter && row.supporter !== "unknown") score += 1;
  if (row.lawn_sign) score += 1;
  if (row.newsletter_consent) score += 1;
  if (Number(row.number_of_votes) > 1) score += 1;
  return score;
}

/**
 * Group rows that share a door. Groups where the same person's name repeats are
 * near-certain duplicates; the rest may just be two people in one household, so
 * they are reported separately and never merged automatically.
 */
export function findDuplicateGroups(rows) {
  const byAddress = new Map();
  for (const row of rows) {
    const key = addressKey(row);
    if (!key) continue;
    if (!byAddress.has(key)) byAddress.set(key, []);
    byAddress.get(key).push(row);
  }

  const groups = [];
  for (const [key, groupRows] of byAddress) {
    if (groupRows.length < 2) continue;

    const nameCounts = new Map();
    for (const row of groupRows) {
      const name = normalizePersonName(row);
      if (!name) continue;
      nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
    }

    const sorted = [...groupRows].sort(oldestFirst);
    const repeatedNameIds = sorted
      .filter((row) => (nameCounts.get(normalizePersonName(row)) || 0) > 1)
      .map((row) => row.id);
    const namelessCount = sorted.filter((row) => !normalizePersonName(row)).length;

    groups.push({
      key,
      address: formatAddress(sorted[0]),
      rows: sorted,
      repeatedNameIds,
      // "same-name": the same person typed twice. "no-name": rows with nothing
      // but an address, which is what a re-scanned page usually produces.
      kind: repeatedNameIds.length ? "same-name" : namelessCount > 1 ? "no-name" : "same-address",
      suggestedKeepId: [...sorted].sort(
        (a, b) => completeness(b) - completeness(a) || oldestFirst(a, b),
      )[0].id,
    });
  }

  const rank = { "same-name": 0, "no-name": 1, "same-address": 2 };
  return groups.sort(
    (a, b) =>
      rank[a.kind] - rank[b.kind] ||
      b.rows.length - a.rows.length ||
      a.address.localeCompare(b.address),
  );
}

/** Matches for the live check on the Add form (rows already fetched by number). */
export function findAddressMatches(rows, candidate) {
  const building = buildingKey(candidate);
  if (!building) return { exact: [], otherUnits: [] };
  const key = addressKey(candidate);
  const exact = [];
  const otherUnits = [];
  for (const row of rows) {
    if (buildingKey(row) !== building) continue;
    if (addressKey(row) === key) exact.push(row);
    else otherUnits.push(row);
  }
  return { exact, otherUnits };
}

const TEXT_FIELDS = [
  "street_number",
  "street_name",
  "unit_no",
  "first_name",
  "last_name",
  "cell_number",
  "email",
];

/**
 * Fold a group of duplicates into one record: the kept row wins every field it
 * actually filled in, and blanks are topped up from the others (oldest first).
 * Nothing is summed — these are the same household recorded twice, so votes
 * take the highest single value rather than double-counting.
 */
export function mergeResidents(rows, keepId) {
  const primary = rows.find((row) => row.id === keepId) || rows[0];
  const others = rows.filter((row) => row.id !== primary.id).sort(oldestFirst);
  const ordered = [primary, ...others];

  const payload = {};
  for (const field of TEXT_FIELDS) {
    const filled = ordered.map((row) => meaningful(row[field])).find(Boolean);
    // Falling back to the primary's own value preserves a deliberate "N/A".
    payload[field] = filled || String(primary[field] ?? "");
  }

  payload.supporter =
    ordered.map((row) => row.supporter).find((s) => s === "yes" || s === "no") || "unknown";
  payload.number_of_votes = Math.max(...ordered.map((row) => Number(row.number_of_votes) || 0));
  payload.lawn_sign = ordered.some((row) => !!row.lawn_sign);
  payload.newsletter_consent = ordered.some((row) => !!row.newsletter_consent);

  const comments = [];
  for (const row of ordered) {
    const text = meaningful(row.comments);
    if (text && !comments.includes(text)) comments.push(text);
  }
  payload.comments = comments.join("\n");

  return { keepId: primary.id, payload, removeIds: others.map((row) => row.id) };
}

/**
 * Distinct streets with their entry counts, rarest first — nonsense names from
 * a mis-read scan ("Upp", "Muslim") sit at the top with a count of 1.
 */
export function summarizeStreets(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = normalizeStreetName(row.street_name);
    if (!key) continue;
    const label = normalizeStreetPart(row.street_name);
    if (!byKey.has(key)) byKey.set(key, { key, labels: new Map(), ids: [], samples: [] });
    const entry = byKey.get(key);
    entry.labels.set(label, (entry.labels.get(label) || 0) + 1);
    entry.ids.push(row.id);
    if (entry.samples.length < 6) entry.samples.push(formatAddress(row));
  }

  return [...byKey.values()]
    .map((entry) => ({
      key: entry.key,
      // Show the spelling that appears most often.
      label: [...entry.labels.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
      variants: [...entry.labels.keys()].sort(),
      count: entry.ids.length,
      ids: entry.ids,
      samples: entry.samples,
    }))
    .sort((a, b) => a.count - b.count || a.label.localeCompare(b.label));
}
