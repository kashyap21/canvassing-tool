import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import { findDuplicateGroups, meaningful, mergeResidents, summarizeStreets } from "../lib/duplicates";

const SUPPORTER_LABELS = { yes: "Yes", no: "No", unknown: "Unknown" };
const KIND_LABELS = {
  "same-name": "Same name",
  "no-name": "No name on either",
  "same-address": "Same address",
};
const MAX_GROUPS = 60;
const MAX_STREETS = 60;
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
export default function DataCleanupModal({ rows, online, onClose, onApplied }) {
  const [tab, setTab] = useState("duplicates");
  const [keepIds, setKeepIds] = useState({});
  const [dismissed, setDismissed] = useState([]);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [onlySameName, setOnlySameName] = useState(false);
  const [streetQuery, setStreetQuery] = useState("");
  const [renaming, setRenaming] = useState(null); // { key, value }

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const groups = useMemo(() => findDuplicateGroups(rows), [rows]);
  const streets = useMemo(() => summarizeStreets(rows), [rows]);

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

  async function saveRename(street) {
    const value = renaming.value.trim().replace(/\s+/g, " ");
    if (!value) {
      setError("Enter a street name.");
      return;
    }
    if (
      !window.confirm(
        `Rename "${street.label}" to "${value}" on ${street.count} entr${street.count === 1 ? "y" : "ies"}?`,
      )
    )
      return;

    setBusyKey(`street:${street.key}`);
    setError("");
    setFlash("");

    const updated = [];
    for (const ids of chunk(street.ids, ID_CHUNK)) {
      const { data, error: updateError } = await supabase
        .from("residents")
        .update({ street_name: value })
        .in("id", ids)
        .select();
      if (updateError) {
        setBusyKey("");
        setError(updateError.message);
        if (updated.length) onApplied({ updated, removedIds: [] });
        return;
      }
      updated.push(...(data || []));
    }

    setBusyKey("");
    setRenaming(null);
    onApplied({ updated, removedIds: [] });
    setFlash(`Renamed ${updated.length} entr${updated.length === 1 ? "y" : "ies"} to "${value}".`);
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
              usually a mis-read scan. Renaming updates every entry on that street at once.
            </p>

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

            <ul className="street-list">
              {visibleStreets.slice(0, MAX_STREETS).map((street) => (
                <li className="street-row" key={street.key}>
                  <div className="street-main">
                    <span className="street-name">{street.label}</span>
                    <span className={street.count <= 2 ? "street-count is-rare" : "street-count"}>
                      {street.count} entr{street.count === 1 ? "y" : "ies"}
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
