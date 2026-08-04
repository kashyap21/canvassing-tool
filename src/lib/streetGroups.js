// Finding street names that are the same street typed (or scanned) wrong.
//
// summarizeStreets() already folds spelling variants that normalize to the same
// key ("Maple St" / "Maple Street"). What it cannot fold is a genuine typo —
// "Uppr Ottawa" and "Upp" normalize to keys of their own, so they sit in the
// list as separate streets and have to be repaired by hand, one at a time.
//
// Everything here only ever *suggests*. A suggestion needs a rare name (the
// mis-scan) and a clearly more common one to fold it into, and it is dropped
// when more than one common street is an equally good candidate — guessing
// between "Mayfield" and "Maybrook" for a stray "May" would be worse than
// leaving it for a human.

const RARE_MAX = 2; // entries: at most this many and it is probably a mis-scan
const DOMINANT_MIN = 3; // entries: at least this many to be worth folding into
const SHORT_KEY = 8; // keys shorter than this only tolerate a single typo
const MIN_PREFIX = 3; // "Up" is too little to go on; "Upp" is enough

/**
 * Levenshtein distance, abandoned as soon as it passes `cutoff` (returns
 * cutoff + 1 in that case) so a long list of streets stays cheap to compare.
 */
export function editDistance(a, b, cutoff = 2) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cutoff) return cutoff + 1;

  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let curr = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > cutoff) return cutoff + 1; // no cell can recover from here
    [prev, curr] = [curr, prev];
  }
  return prev[b.length] > cutoff ? cutoff + 1 : prev[b.length];
}

/** How close two canonical keys are, or null when they are not related. */
function relate(rareKey, dominantKey) {
  const cutoff = Math.min(rareKey.length, dominantKey.length) < SHORT_KEY ? 1 : 2;
  const distance = editDistance(rareKey, dominantKey, cutoff);
  if (distance <= cutoff) return { reason: "typo", distance };
  // A scan that stopped early: "Upp" for "Upper Ottawa".
  if (rareKey.length >= MIN_PREFIX && dominantKey.startsWith(rareKey))
    return { reason: "truncated", distance: dominantKey.length - rareKey.length };
  return null;
}

/**
 * Group rare street names under the common street they were probably meant to
 * be. Takes the output of summarizeStreets() and returns one cluster per target
 * street, most entries to repair first.
 */
export function findStreetClusters(streets, { rareMax = RARE_MAX, dominantMin = DOMINANT_MIN } = {}) {
  const rare = (streets || []).filter((s) => s.count <= rareMax);
  const dominant = (streets || []).filter((s) => s.count >= dominantMin);
  if (!rare.length || !dominant.length) return [];

  const byTarget = new Map();

  for (const variant of rare) {
    // Best = fewest edits, then the most-used street. A tie between two
    // different streets means we genuinely cannot tell, so nothing is offered.
    let best = null;
    let tied = false;
    for (const target of dominant) {
      if (target.key === variant.key) continue;
      const link = relate(variant.key, target.key);
      if (!link) continue;
      if (!best) {
        best = { target, ...link };
        continue;
      }
      const closer = link.distance - best.distance;
      if (closer < 0 || (closer === 0 && target.count > best.target.count)) {
        best = { target, ...link };
        tied = false;
      } else if (closer === 0 && target.count === best.target.count) {
        tied = true;
      }
    }
    if (!best || tied) continue;

    if (!byTarget.has(best.target.key)) byTarget.set(best.target.key, { target: best.target, variants: [] });
    byTarget.get(best.target.key).variants.push({ ...variant, reason: best.reason, distance: best.distance });
  }

  return [...byTarget.values()]
    .map(({ target, variants }) => ({
      key: target.key,
      target,
      variants: variants.sort((a, b) => a.distance - b.distance || a.label.localeCompare(b.label)),
      // Entries that would actually change if the cluster were applied.
      entryCount: variants.reduce((n, v) => n + v.count, 0),
      keys: [...variants.map((v) => v.key), target.key],
    }))
    .sort((a, b) => b.entryCount - a.entryCount || a.target.label.localeCompare(b.target.label));
}

/**
 * What a bulk rename of the ticked streets would touch, and the name to offer as
 * the target: the ticked spelling that is already used on the most entries.
 */
export function selectionSummary(streets, selectedKeys) {
  const keys = selectedKeys instanceof Set ? selectedKeys : new Set(selectedKeys || []);
  const picked = (streets || []).filter((s) => keys.has(s.key));
  const ids = picked.flatMap((s) => s.ids || []);
  const suggestedName = [...picked].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label),
  )[0]?.label ?? "";
  return {
    streetCount: picked.length,
    entryCount: ids.length,
    ids,
    suggestedName,
  };
}
