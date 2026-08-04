import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import { findDuplicateGroups, meaningful, mergeResidents, summarizeStreets } from "../lib/duplicates";
import { findStreetClusters, selectionSummary } from "../lib/streetGroups";
import StreetAutocomplete from "./StreetAutocomplete";

const SUPPORTER_LABELS = { yes: "Yes", no: "No", unknown: "Unknown" };
const KIND_LABELS = {
  "same-name": "Same name",
  "no-name": "No name on either",
  "same-address": "Same address",
};
const MAX_GROUPS = 60;
const MAX_STREETS = 60;
const MAX_CLUSTERS = 12;
const ID_CHUNK = 200; // keep the ?id=in.(…) query string a sane length

const residentName = (r) => [r.first_name, r.last_name].filter(Boolean).join(" ").trim();

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Clean-up tool for the Data tab: merge entries that landed in the table twice,
 * and repair street names that came out of the scans wrong.
 */
export default function DataCleanupModal({
  rows,
  online,
  initialTab = "duplicates",
  initialStreetQuery = "",
  onClose,
  onApplied,
}) {
  const [tab, setTab] = useState(initialTab);
  const [keepIds, setKeepIds] = useState({});
  const [dismissed, setDismissed] = useState([]);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [onlySameName, setOnlySameName] = useState(false);
  const [streetQuery, setStreetQuery] = useState(initialStreetQuery);
  const [renaming, setRenaming] = useState(null); // { key, value }

  // Bulk rename: the ticked streets and the one name they should all become.
  const [selected, setSelected] = useState(() => new Set());
  const [bulkName, setBulkName] = useState("");

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const groups = useMemo(() => findDuplicateGroups(rows), [rows]);
  const streets = useMemo(() => summarizeStreets(rows), [rows]);
  const streetLabels = useMemo(() => streets.map((s) => s.label), [streets]);
  const clusters = useMemo(() => findStreetClusters(streets), [streets]);
  const selection = useMemo(() => selectionSummary(streets, selected), [streets, selected]);

  // Offer the busiest ticked spelling as the target, until something is typed.
  useEffect(() => {
    if (!selected.size) return;
    setBulkName((current) => current || selection.suggestedName);
  }, [selected, selection.suggestedName]);

  const visibleGroups = groups.filter(
    (g) => !dismissed.includes(g.key) && (!onlySameName || g.kind === "same-name"),
  );
  const duplicateRowCount = groups.reduce((n, g) => n + g.rows.length - 1, 0);

  const streetQ = streetQuery.trim().toLowerCase();
  const visibleStreets = streetQ
    ? streets.filter((s) => s.label.toLowerCase().includes(streetQ))
    : streets;

  async function mergeGroup(group) {
    const keepId = keepIds[group.key] ?? group.suggestedKeepId;
    const { payload, removeIds } = mergeResidents(group.rows, keepId);

    setBusyKey(group.key);
    setError("");
    setFlash("");

    const { data, error: updateError } = await supabase
      .from("residents")
      .update(payload)
      .eq("id", keepId)
      .select()
      .single();

    if (updateError) {
      setBusyKey("");
      setError(`Could not merge: ${updateError.message}`);
      return;
    }

    const { error: deleteError } = await supabase.from("residents").delete().in("id", removeIds);
    setBusyKey("");

    if (deleteError) {
      // The keeper already holds the merged values; the extras just survived.
      onApplied({ updated: [data], removedIds: [] });
      setError(`Merged the details but could not remove the extra entries: ${deleteError.message}`);
      return;
    }

    onApplied({ updated: [data], removedIds: removeIds });
    setFlash(`Merged ${removeIds.length + 1} entries at ${group.address}.`);
  }

  async function deleteRow(group, row) {
    const label = residentName(row) || "this entry";
    if (!window.confirm(`Delete ${label} at ${group.address}?\n\nThis cannot be undone.`)) return;

    setBusyKey(`${group.key}:${row.id}`);
    setError("");
    setFlash("");
    const { error: deleteError } = await supabase.from("residents").delete().eq("id", row.id);
    setBusyKey("");

    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    onApplied({ updated: [], removedIds: [row.id] });
    setFlash(`Deleted ${label} at ${group.address}.`);
  }

  // Write one street name across many entries, a chunk of ids at a time. Returns
  // whatever was written before any failure, so a partial change still reaches
  // the table instead of being silently dropped.
  async function renameIds(ids, value) {
    const updated = [];
    for (const batch of chunk(ids, ID_CHUNK)) {
      const { data, error: updateError } = await supabase
        .from("residents")
        .update({ street_name: value })
        .in("id", batch)
        .select();
      if (updateError) return { updated, error: updateError };
      updated.push(...(data || []));
    }
    return { updated, error: null };
  }

  const entries = (n) => `${n} entr${n === 1 ? "y" : "ies"}`;

  async function saveRename(street) {
    const value = renaming.value.trim().replace(/\s+/g, " ");
    if (!value) {
      setError("Enter a street name.");
      return;
    }
    if (!window.confirm(`Rename "${street.label}" to "${value}" on ${entries(street.count)}?`)) return;

    setBusyKey(`street:${street.key}`);
    setError("");
    setFlash("");

    const { updated, error: updateError } = await renameIds(street.ids, value);
    setBusyKey("");

    if (updated.length) onApplied({ updated, removedIds: [] });
    if (updateError) {
      setError(updateError.message);
      return;
    }

    setRenaming(null);
    setFlash(`Renamed ${entries(updated.length)} to "${value}".`);
  }

  function toggleStreet(key) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
    setBulkName("");
  }

  // Tick a suggested group (the mis-scans plus the street they belong to) and
  // pre-fill the target with the busy street's spelling.
  function tickCluster(cluster) {
    setSelected(new Set(cluster.keys));
    setBulkName(cluster.target.label);
  }

  async function applyBulkRename() {
    const value = bulkName.trim().replace(/\s+/g, " ");
    if (!value) {
      setError("Enter the street name to use.");
      return;
    }
    if (!selection.entryCount) {
      setError("Tick at least one street first.");
      return;
    }
    if (
      !window.confirm(
        `Rename ${selection.streetCount} street${selection.streetCount === 1 ? "" : "s"} — ` +
          `${entries(selection.entryCount)} — to "${value}"?\n\nThis cannot be undone.`,
      )
    )
      return;

    setBusyKey("bulk");
    setError("");
    setFlash("");

    // Every ticked entry is written, including ones already spelt this way, so a
    // group holding several spellings ends up completely consistent.
    const { updated, error: updateError } = await renameIds(selection.ids, value);
    setBusyKey("");

    if (updated.length) onApplied({ updated, removedIds: [] });
    if (updateError) {
      setError(updateError.message);
      return;
    }

    clearSelection();
    setFlash(`Renamed ${entries(updated.length)} to "${value}".`);
  }

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal modal-wide"
        role="dialog"
        aria-modal="true"
        aria-label="Clean up data"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>Clean up data</h2>
          <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="tabs tabs-inline">
          <button
            type="button"
            className={tab === "duplicates" ? "tab active" : "tab"}
            onClick={() => setTab("duplicates")}
          >
            Duplicates ({groups.length})
          </button>
          <button
            type="button"
            className={tab === "streets" ? "tab active" : "tab"}
            onClick={() => setTab("streets")}
          >
            Street names ({streets.length})
          </button>
        </div>

        {error && <div className="flash flash-error">{error}</div>}
        {flash && <div className="flash flash-success">✓ {flash}</div>}
        {!online && <div className="flash flash-error">You are offline — changes cannot be saved.</div>}

        {tab === "duplicates" ? (
          <div className="cleanup-body">
            <p className="sub">
              {groups.length === 0
                ? "No repeated addresses found."
                : `${groups.length} address${groups.length === 1 ? "" : "es"} recorded more than once — ${duplicateRowCount} extra entr${duplicateRowCount === 1 ? "y" : "ies"}. Merging keeps the entry you tick and fills its blanks from the others; votes are never added together.`}
            </p>

            {groups.length > 0 && (
              <label className="na-toggle cleanup-filter">
                <input
                  type="checkbox"
                  checked={onlySameName}
                  onChange={(e) => setOnlySameName(e.target.checked)}
                />
                <span>Only the same name twice</span>
              </label>
            )}

            {visibleGroups.slice(0, MAX_GROUPS).map((group) => {
              const keepId = keepIds[group.key] ?? group.suggestedKeepId;
              const busy = busyKey === group.key;
              return (
                <section className="dup-group" key={group.key}>
                  <header className="dup-group-head">
                    <h3>{group.address}</h3>
                    <span className={`badge badge-${group.kind}`}>{KIND_LABELS[group.kind]}</span>
                    <span className="dup-count">{group.rows.length} entries</span>
                  </header>

                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Keep</th>
                          <th>Name</th>
                          <th>Unit</th>
                          <th>Cell</th>
                          <th>Supporter</th>
                          <th>Votes</th>
                          <th>Added</th>
                          <th aria-label="Actions"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map((row) => (
                          <tr key={row.id}>
                            <td>
                              <input
                                type="radio"
                                name={`keep-${group.key}`}
                                checked={keepId === row.id}
                                onChange={() =>
                                  setKeepIds((current) => ({ ...current, [group.key]: row.id }))
                                }
                              />
                            </td>
                            <td>
                              {residentName(row) || <span className="muted-cell">— no name —</span>}
                              {group.repeatedNameIds.includes(row.id) && (
                                <span className="badge badge-same-name">repeat</span>
                              )}
                            </td>
                            <td>{meaningful(row.unit_no) || ""}</td>
                            <td>{meaningful(row.cell_number) || ""}</td>
                            <td>{SUPPORTER_LABELS[row.supporter] || row.supporter}</td>
                            <td>{row.number_of_votes}</td>
                            <td>{new Date(row.created_at).toLocaleDateString()}</td>
                            <td className="col-actions">
                              <button
                                type="button"
                                className="btn btn-delete"
                                disabled={!online || busyKey === `${group.key}:${row.id}`}
                                onClick={() => deleteRow(group, row)}
                              >
                                {busyKey === `${group.key}:${row.id}` ? "Deleting…" : "Delete"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="dup-group-actions">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setDismissed((current) => [...current, group.key])}
                    >
                      Not a duplicate
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={!online || busy}
                      onClick={() => mergeGroup(group)}
                    >
                      {busy ? "Merging…" : `Merge into the ticked entry`}
                    </button>
                  </div>
                </section>
              );
            })}

            {visibleGroups.length > MAX_GROUPS && (
              <p className="sub">
                Showing the first {MAX_GROUPS} of {visibleGroups.length}. Merge these and the rest
                will appear.
              </p>
            )}
            {groups.length > 0 && visibleGroups.length === 0 && (
              <p className="sub">Nothing left to review here.</p>
            )}
          </div>
        ) : (
          <div className="cleanup-body">
            <p className="sub">
              Every street in the database, rarest first — a name that appears once or twice is
              usually a mis-read scan. Rename one street on its own, or tick several and give them
              all the same name in one go.
            </p>

            {clusters.length > 0 && (
              <section className="street-suggest">
                <h3>Likely mis-scans</h3>
                <p className="sub">
                  Rare spellings that look like a busier street. Ticking a group only fills in the
                  box below — nothing changes until you apply it.
                </p>
                <ul className="street-suggest-list">
                  {clusters.slice(0, MAX_CLUSTERS).map((cluster) => (
                    <li key={cluster.key}>
                      <p className="street-suggest-line">
                        {cluster.variants.map((v) => (
                          <span className="street-variant" key={v.key}>
                            {v.label} <span className="street-count is-rare">{v.count}</span>
                            {v.reason === "truncated" && <span className="badge">cut short</span>}
                          </span>
                        ))}
                        <span className="street-arrow" aria-hidden="true">
                          →
                        </span>
                        <span className="street-name">{cluster.target.label}</span>
                        <span className="street-count">{cluster.target.count}</span>
                      </p>
                      <button type="button" className="btn" onClick={() => tickCluster(cluster)}>
                        Tick this group · {entries(cluster.entryCount)} to fix
                      </button>
                    </li>
                  ))}
                </ul>
                {clusters.length > MAX_CLUSTERS && (
                  <p className="sub">
                    Showing the {MAX_CLUSTERS} biggest of {clusters.length} suggested groups.
                  </p>
                )}
              </section>
            )}

            <div className="filter">
              <label htmlFor="street-search">Find a street</label>
              <input
                id="street-search"
                type="text"
                placeholder="Street name…"
                value={streetQuery}
                onChange={(e) => setStreetQuery(e.target.value)}
              />
            </div>

            {visibleStreets.length > 1 && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setSelected(new Set(visibleStreets.map((s) => s.key)))}
              >
                Tick all {visibleStreets.length} shown
              </button>
            )}

            {selection.streetCount > 0 && (
              <section className="street-bulk" aria-label="Rename the ticked streets">
                <p className="street-bulk-count">
                  <strong>
                    {selection.streetCount} street{selection.streetCount === 1 ? "" : "s"} ticked
                  </strong>{" "}
                  · {entries(selection.entryCount)} will be renamed
                </p>
                <div className="street-bulk-row">
                  <StreetAutocomplete
                    id="bulk-street-name"
                    listId="bulk-street-options"
                    placeholder="Name to use for all of them"
                    streets={streetLabels}
                    value={bulkName}
                    onChange={setBulkName}
                    dropUp
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!online || busyKey === "bulk" || !bulkName.trim()}
                    onClick={applyBulkRename}
                  >
                    {busyKey === "bulk" ? "Renaming…" : "Rename all ticked"}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={clearSelection}>
                    Clear
                  </button>
                </div>
              </section>
            )}

            <ul className="street-list">
              {visibleStreets.slice(0, MAX_STREETS).map((street) => (
                <li
                  className={selected.has(street.key) ? "street-row is-ticked" : "street-row"}
                  key={street.key}
                >
                  <div className="street-main">
                    <label className="street-tick">
                      <input
                        type="checkbox"
                        checked={selected.has(street.key)}
                        onChange={() => toggleStreet(street.key)}
                      />
                      <span className="street-name">{street.label}</span>
                    </label>
                    <span className={street.count <= 2 ? "street-count is-rare" : "street-count"}>
                      {entries(street.count)}
                    </span>
                  </div>
                  <p className="street-samples">{street.samples.join(" · ")}</p>
                  {street.variants.length > 1 && (
                    <p className="street-samples">Spelt as: {street.variants.join(" / ")}</p>
                  )}

                  {renaming?.key === street.key ? (
                    <div className="street-rename">
                      <input
                        type="text"
                        value={renaming.value}
                        autoFocus
                        onChange={(e) => setRenaming({ key: street.key, value: e.target.value })}
                      />
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={!online || busyKey === `street:${street.key}`}
                        onClick={() => saveRename(street)}
                      >
                        {busyKey === `street:${street.key}` ? "Saving…" : "Save"}
                      </button>
                      <button type="button" className="btn btn-ghost" onClick={() => setRenaming(null)}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setRenaming({ key: street.key, value: street.label })}
                    >
                      Rename
                    </button>
                  )}
                </li>
              ))}
            </ul>

            {visibleStreets.length > MAX_STREETS && (
              <p className="sub">
                Showing the first {MAX_STREETS} of {visibleStreets.length} — search to narrow it
                down.
              </p>
            )}
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
