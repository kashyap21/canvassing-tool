import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import { downloadCsv } from "../lib/csv";
import EditResidentModal from "./EditResidentModal";

const PAGE = 1000; // Supabase returns at most 1000 rows per request.
const SUPPORTER_LABELS = { yes: "Yes", no: "No", unknown: "Unknown" };
const PAGE_SIZES = [25, 50, 100, 200];

// A resident is "N/A" when the canvasser ticked "No details given", which
// stamps the name / phone / email fields with the literal "N/A".
const isNa = (r) => r.first_name === "N/A";

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

export default function ResidentsList() {
  const [allRows, setAllRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const data = await fetchAllResidents();
        if (!cancelled) setAllRows(data);
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Distinct street names, for the street filter dropdown.
  const streets = useMemo(() => {
    const set = new Set();
    for (const r of allRows) if (r.street_name) set.add(r.street_name);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [allRows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter((r) => {
      if (hideNa && isNa(r)) return false;
      if (street && r.street_name !== street) return false;
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
    });
  }, [allRows, search, street, supporter, sign, hideNa]);

  const filtersActive = Boolean(search.trim() || street || supporter || sign || hideNa);

  // Reset to the first page whenever the result set changes.
  useEffect(() => {
    setPage(1);
  }, [search, street, supporter, sign, hideNa, pageSize]);

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

  // Swap the updated row into the local list so the table reflects the edit
  // without a full refetch, then close the modal.
  function handleSaved(updated) {
    setAllRows((rows) => rows.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
    setEditing(null);
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
                {s}
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
              <th>Name</th>
              <th>Address</th>
              <th>Cell</th>
              <th>Supporter</th>
              <th>Votes</th>
              <th>Sign</th>
              <th>News</th>
              <th>Added</th>
              <th aria-label="Actions"></th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.first_name} {r.last_name}
                </td>
                <td>
                  {r.street_number} {r.street_name}
                  {r.unit_no ? ` · #${r.unit_no}` : ""}
                </td>
                <td>{r.cell_number}</td>
                <td>{SUPPORTER_LABELS[r.supporter] || r.supporter}</td>
                <td>{r.number_of_votes}</td>
                <td>{r.lawn_sign ? "Yes" : "No"}</td>
                <td>{r.newsletter_consent ? "Yes" : "No"}</td>
                <td>{new Date(r.created_at).toLocaleString()}</td>
                <td className="col-actions">
                  <button type="button" className="btn btn-edit" onClick={() => setEditing(r)}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan="9" className="empty">
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
    </div>
  );
}
