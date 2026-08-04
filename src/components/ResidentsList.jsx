import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import { downloadCsv } from "../lib/csv";
import { normalizeStreetPart } from "../lib/normalizeResident";
import { findDuplicateGroups } from "../lib/duplicates";
import DataCleanupModal from "./DataCleanupModal";
import EditResidentModal from "./EditResidentModal";

const PAGE = 1000; // Supabase returns at most 1000 rows per request.
const SUPPORTER_LABELS = { yes: "Yes", no: "No", unknown: "Unknown" };
const PAGE_SIZES = [25, 50, 100, 200];
const ADDRESS_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

// A resident is "N/A" when the canvasser ticked "No details given", which
// stamps the name / phone / email fields with the literal "N/A".
const isNa = (r) => r.first_name === "N/A";
const residentName = (r) => [r.first_name, r.last_name].filter(Boolean).join(" ");
const sortByAddress = (a, b) =>
  ADDRESS_COLLATOR.compare(normalizeStreetPart(a.street_name), normalizeStreetPart(b.street_name)) ||
  ADDRESS_COLLATOR.compare(normalizeStreetPart(a.street_number), normalizeStreetPart(b.street_number)) ||
  ADDRESS_COLLATOR.compare(normalizeStreetPart(a.unit_no), normalizeStreetPart(b.unit_no)) ||
  ADDRESS_COLLATOR.compare(a.last_name || "", b.last_name || "") ||
  ADDRESS_COLLATOR.compare(a.first_name || "", b.first_name || "");
const sortByStreetNumber = (a, b) =>
  ADDRESS_COLLATOR.compare(normalizeStreetPart(a.street_number), normalizeStreetPart(b.street_number)) ||
  ADDRESS_COLLATOR.compare(normalizeStreetPart(a.street_name), normalizeStreetPart(b.street_name)) ||
  ADDRESS_COLLATOR.compare(normalizeStreetPart(a.unit_no), normalizeStreetPart(b.unit_no)) ||
  ADDRESS_COLLATOR.compare(a.last_name || "", b.last_name || "") ||
  ADDRESS_COLLATOR.compare(a.first_name || "", b.first_name || "");
const SORTERS = {
  street_number: sortByStreetNumber,
  street_name: sortByAddress,
  unit_no: (a, b) => ADDRESS_COLLATOR.compare(normalizeStreetPart(a.unit_no), normalizeStreetPart(b.unit_no)),
  name: (a, b) => ADDRESS_COLLATOR.compare(residentName(a), residentName(b)),
  cell_number: (a, b) => ADDRESS_COLLATOR.compare(a.cell_number || "", b.cell_number || ""),
  supporter: (a, b) => ADDRESS_COLLATOR.compare(SUPPORTER_LABELS[a.supporter] || a.supporter || "", SUPPORTER_LABELS[b.supporter] || b.supporter || ""),
  number_of_votes: (a, b) => (Number(a.number_of_votes) || 0) - (Number(b.number_of_votes) || 0),
  lawn_sign: (a, b) => Number(a.lawn_sign) - Number(b.lawn_sign),
  newsletter_consent: (a, b) => Number(a.newsletter_consent) - Number(b.newsletter_consent),
  created_at: (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
};
const SORT_FALLBACKS = {
  street_number: sortByStreetNumber,
  street_name: sortByAddress,
};

// Fetch EVERY row, page by page, so filtering / export cover all 7000+.
async function fetchAllResidents() {
  let from = 0;
  const all = [];
  for (;;) {
    const { data, error } = await supabase
      .from("residents")
      .select("*")
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

export default function ResidentsList({ online, refreshKey }) {
  const [allRows, setAllRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [sort, setSort] = useState({ key: "street_name", dir: "asc" });
  const [deletingId, setDeletingId] = useState(null);

  // Filters
  const [search, setSearch] = useState("");
  const [street, setStreet] = useState("");
  const [supporter, setSupporter] = useState("");
  const [sign, setSign] = useState(""); // "" | "yes" | "no"
  const [hideNa, setHideNa] = useState(false);

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // The resident currently open in the edit modal (null when closed).
  const [editing, setEditing] = useState(null);
  const [cleanupOpen, setCleanupOpen] = useState(false);

  const loadRows = useCallback(async ({ showLoading = false } = {}) => {
    if (!online) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (showLoading) setLoading(true);
    else setRefreshing(true);
    setError("");
    try {
      setAllRows(await fetchAllResidents());
    } catch (e) {
      setError(e.message);
    } finally {
      if (showLoading) setLoading(false);
      else setRefreshing(false);
    }
  }, [online]);

  useEffect(() => {
    loadRows({ showLoading: allRows.length === 0 });
    // refreshKey intentionally refetches data pushed from App events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRows, refreshKey]);

  useEffect(() => {
    if (!online) return undefined;
    const timer = setInterval(() => loadRows(), 5000);
    return () => clearInterval(timer);
  }, [loadRows, online]);

  useEffect(() => {
    if (!online) return undefined;
    const channel = supabase
      .channel("residents-table-refresh")
      .on("postgres_changes", { event: "*", schema: "public", table: "residents" }, () => loadRows())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadRows, online]);

  // Distinct street names, for the street filter dropdown. The counts make a
  // mis-scanned street name ("Upp (1)") obvious without opening every row.
  const streetCounts = useMemo(() => {
    const counts = new Map();
    for (const r of allRows) {
      const normalized = normalizeStreetPart(r.street_name);
      if (normalized) counts.set(normalized, (counts.get(normalized) || 0) + 1);
    }
    return counts;
  }, [allRows]);

  const streets = useMemo(
    () => [...streetCounts.keys()].sort((a, b) => a.localeCompare(b)),
    [streetCounts],
  );

  const duplicateGroupCount = useMemo(() => findDuplicateGroups(allRows).length, [allRows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter((r) => {
      if (hideNa && isNa(r)) return false;
      if (street && normalizeStreetPart(r.street_name) !== street) return false;
      if (supporter && r.supporter !== supporter) return false;
      if (sign === "yes" && !r.lawn_sign) return false;
      if (sign === "no" && r.lawn_sign) return false;
      if (q) {
        const hay = [
          r.first_name,
          r.last_name,
          r.street_number,
          r.street_name,
          r.unit_no,
          r.cell_number,
          r.email,
          r.comments,
        ]
          .map((x) => (x == null ? "" : String(x).toLowerCase()))
          .join(" ");
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => {
      const primary = SORTERS[sort.key]?.(a, b) || 0;
      const fallback = SORT_FALLBACKS[sort.key]?.(a, b) || sortByAddress(a, b);
      return (primary || fallback) * (sort.dir === "asc" ? 1 : -1);
    });
  }, [allRows, search, street, supporter, sign, hideNa, sort]);

  const filtersActive = Boolean(search.trim() || street || supporter || sign || hideNa);

  // Reset to the first page whenever the result set changes.
  useEffect(() => {
    setPage(1);
  }, [search, street, supporter, sign, hideNa, pageSize, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const pageRows = filtered.slice(start, start + pageSize);

  function clearFilters() {
    setSearch("");
    setStreet("");
    setSupporter("");
    setSign("");
    setHideNa(false);
  }

  function toggleSort(key) {
    setSort((current) => ({
      key,
      dir: current.key === key && current.dir === "asc" ? "desc" : "asc",
    }));
  }

  function sortArrow(key) {
    if (sort.key !== key) return "";
    return sort.dir === "asc" ? "↑" : "↓";
  }

  function sortableHeader(key, label) {
    const active = sort.key === key;
    return (
      <th aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
        <button
          type="button"
          className="sort-header"
          aria-label={`Sort ${label} ${active && sort.dir === "asc" ? "descending" : "ascending"}`}
          onClick={() => toggleSort(key)}
        >
          {label}
          <span aria-hidden="true">{sortArrow(key)}</span>
        </button>
      </th>
    );
  }

  // Swap the updated row into the local list so the table reflects the edit
  // without a full refetch, then close the modal.
  function handleSaved(updated) {
    setAllRows((rows) => rows.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
    setEditing(null);
  }

  // Merges / renames / deletes made in the clean-up tool, folded into the table
  // straight away so the modal reflects what is left to fix.
  function handleCleanupApplied({ updated = [], removedIds = [] }) {
    setAllRows((rows) => {
      const patched = new Map(updated.map((row) => [row.id, row]));
      const removed = new Set(removedIds);
      return rows
        .filter((row) => !removed.has(row.id))
        .map((row) => (patched.has(row.id) ? { ...row, ...patched.get(row.id) } : row));
    });
  }

  async function handleDelete(row) {
    const name = residentName(row) || "this resident";
    const address = [row.street_number, row.street_name, row.unit_no ? `#${row.unit_no}` : ""]
      .filter(Boolean)
      .join(" ");
    const confirmed = window.confirm(`Delete ${name} at ${address}?\n\nThis cannot be undone.`);
    if (!confirmed) return;

    setDeletingId(row.id);
    setError("");
    const { error: deleteError } = await supabase
      .from("residents")
      .delete()
      .eq("id", row.id);
    setDeletingId(null);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setAllRows((rows) => rows.filter((r) => r.id !== row.id));
  }

  return (
    <div className="card">
      <header className="card-head">
        <h1>Residents</h1>
        <p className="sub">
          {loading
            ? "Loading…"
            : filtersActive
              ? `${filtered.length} of ${allRows.length} residents`
              : `${allRows.length} resident${allRows.length === 1 ? "" : "s"}`}
        </p>
      </header>

      {error && <div className="flash flash-error">{error}</div>}

      <div className="filters">
        <div className="filter filter-search">
          <label htmlFor="f-search">Search</label>
          <input
            id="f-search"
            type="text"
            placeholder="Name, address, phone, email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="filter">
          <label htmlFor="f-street">Street</label>
          <select id="f-street" value={street} onChange={(e) => setStreet(e.target.value)}>
            <option value="">All streets</option>
            {streets.map((s) => (
              <option key={s} value={s}>
                {s} ({streetCounts.get(s)})
              </option>
            ))}
          </select>
        </div>

        <div className="filter">
          <label htmlFor="f-supporter">Supporter</label>
          <select
            id="f-supporter"
            value={supporter}
            onChange={(e) => setSupporter(e.target.value)}
          >
            <option value="">All</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
            <option value="unknown">Unknown</option>
          </select>
        </div>

        <div className="filter">
          <label htmlFor="f-sign">Lawn sign</label>
          <select id="f-sign" value={sign} onChange={(e) => setSign(e.target.value)}>
            <option value="">All</option>
            <option value="yes">Has sign</option>
            <option value="no">No sign</option>
          </select>
        </div>

        <label className="na-toggle">
          <input type="checkbox" checked={hideNa} onChange={(e) => setHideNa(e.target.checked)} />
          <span>Hide N/A</span>
        </label>
      </div>

      <div className="list-actions">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={clearFilters}
          disabled={!filtersActive}
        >
          Clear filters
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => loadRows()}
          disabled={!online || loading || refreshing}
        >
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
        <button
          type="button"
          className={duplicateGroupCount > 0 ? "btn btn-alert" : "btn"}
          disabled={loading || allRows.length === 0}
          onClick={() => setCleanupOpen(true)}
        >
          Clean up{duplicateGroupCount > 0 ? ` (${duplicateGroupCount} duplicates)` : ""}
        </button>
        <button
          type="button"
          className="btn btn-primary export-btn"
          disabled={loading || filtered.length === 0}
          onClick={() => downloadCsv(filtered)}
        >
          Export CSV{filtersActive ? " (filtered)" : ""}
        </button>
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              {sortableHeader("street_number", "Street #")}
              {sortableHeader("street_name", "Street Name")}
              {sortableHeader("unit_no", "Unit")}
              {sortableHeader("name", "Name")}
              {sortableHeader("cell_number", "Cell")}
              {sortableHeader("supporter", "Supporter")}
              {sortableHeader("number_of_votes", "Votes")}
              {sortableHeader("lawn_sign", "Sign")}
              {sortableHeader("newsletter_consent", "News")}
              {sortableHeader("created_at", "Added")}
              <th aria-label="Actions"></th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr key={r.id}>
                <td>{r.street_number}</td>
                <td>{r.street_name}</td>
                <td>{r.unit_no || ""}</td>
                <td>{residentName(r)}</td>
                <td>{r.cell_number}</td>
                <td>{SUPPORTER_LABELS[r.supporter] || r.supporter}</td>
                <td>{r.number_of_votes}</td>
                <td>{r.lawn_sign ? "Yes" : "No"}</td>
                <td>{r.newsletter_consent ? "Yes" : "No"}</td>
                <td>{new Date(r.created_at).toLocaleString()}</td>
                <td className="col-actions">
                  <div className="row-actions">
                    <button type="button" className="btn btn-edit" onClick={() => setEditing(r)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn-delete"
                      disabled={!online || deletingId === r.id}
                      onClick={() => handleDelete(r)}
                    >
                      {deletingId === r.id ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan="11" className="empty">
                  {allRows.length === 0 ? "No residents yet." : "No residents match these filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {filtered.length > 0 && (
        <div className="pager">
          <span className="pager-status">
            {start + 1}–{Math.min(start + pageSize, filtered.length)} of {filtered.length}
          </span>
          <div className="pager-controls">
            <label className="page-size">
              <span>Rows</span>
              <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn"
              disabled={safePage <= 1}
              onClick={() => setPage(safePage - 1)}
            >
              ‹ Prev
            </button>
            <span className="pager-page">
              Page {safePage} / {totalPages}
            </span>
            <button
              type="button"
              className="btn"
              disabled={safePage >= totalPages}
              onClick={() => setPage(safePage + 1)}
            >
              Next ›
            </button>
          </div>
        </div>
      )}

      {editing && (
        <EditResidentModal
          resident={editing}
          streets={streets}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}

      {cleanupOpen && (
        <DataCleanupModal
          rows={allRows}
          online={online}
          onClose={() => setCleanupOpen(false)}
          onApplied={handleCleanupApplied}
        />
      )}
    </div>
  );
}
