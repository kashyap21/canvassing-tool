import { normalizeStreetName } from "./duplicates";

// Ranking for the Street name suggestion list. Pure functions so they can be
// unit-tested away from the DOM; the component only renders what comes back.

export const MAX_SUGGESTIONS = 8;

/** Lowercase, single-spaced — what the substring match runs against. */
export function normalizeQuery(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Lower ranks are offered first:
//   0  the street starts with what was typed        "Map" → "Maple Street"
//   1  a later word starts with it                  "Map" → "Old Maple Lane"
//   2  matched inside a word                        "apl" → "Maple Street"
//   3  matched only once suffixes are canonicalized "Maple Street" → "Maple St"
export function rankOf(street, query) {
  const hay = normalizeQuery(street);
  const at = hay.indexOf(query);
  if (at === 0) return 0;
  if (at > 0) return hay[at - 1] === " " ? 1 : 2;

  // Typists write "Maple Street" for a row stored as "Maple St" (and the other
  // way round). normalizeStreetName folds both to the same words.
  const canonStreet = normalizeStreetName(street);
  const canonQuery = normalizeStreetName(query);
  if (canonQuery && canonStreet.startsWith(canonQuery)) return 3;
  return null;
}

/** Case-insensitive de-duplication, keeping the first spelling seen. */
export function uniqueStreets(streets) {
  const seen = new Set();
  const out = [];
  for (const s of streets || []) {
    const key = normalizeQuery(s);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(String(s).trim());
  }
  return out;
}

/**
 * Streets to offer for what has been typed so far. `streets` is expected to
 * arrive in a stable order (the DB returns them alphabetically), which the
 * stable sort preserves inside each rank.
 */
export function suggestStreets(streets, value, limit = MAX_SUGGESTIONS) {
  const known = uniqueStreets(streets);
  const query = normalizeQuery(value);
  // Empty field: show the first few known streets, like a search box offering
  // recent searches before anything is typed.
  if (!query) return known.slice(0, limit);

  const hits = known
    .map((street) => ({ street, rank: rankOf(street, query) }))
    .filter((h) => h.rank !== null)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map((h) => h.street);

  // Nothing useful left to offer once the typed value is already the one match.
  if (hits.length === 1 && normalizeQuery(hits[0]) === query) return [];
  return hits;
}

/**
 * Split a suggestion into [before, match, after] so the typed run can be shown
 * unbolded and the rest bold, the way search suggestions do it. A rank-3 hit has
 * no literal match, so the whole string comes back as `before`.
 */
export function splitMatch(street, query) {
  if (!query) return [street, "", ""];
  const at = street.toLowerCase().indexOf(query);
  if (at === -1) return [street, "", ""];
  return [street.slice(0, at), street.slice(at, at + query.length), street.slice(at + query.length)];
}
