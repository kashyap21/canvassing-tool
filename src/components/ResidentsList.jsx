import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { downloadCsv } from "../lib/csv";

const PAGE = 1000; // Supabase returns at most 1000 rows per request.
const SUPPORTER_LABELS = { yes: "Yes", no: "No", unknown: "Unknown" };

// Fetch EVERY matching row, page by page, so export/search covers all 7000+.
async function fetchAll(search) {
  let from = 0;
  const all = [];
  for (;;) {
    let query = supabase
      .from("residents")
      .select("*")
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);

    if (search) {
      const term = `%${search}%`;
      query = query.or(
        [
          `first_name.ilike.${term}`,
          `last_name.ilike.${term}`,
          `street_number.ilike.${term}`,
          `street_name.ilike.${term}`,
          `cell_number.ilike.${term}`,
          `email.ilike.${term}`,
          `comments.ilike.${term}`,
        ].join(",")
      );
    }

    const { data, error } = await query;
    if (error) throw error;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

export default function ResidentsList() {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(term) {
    setLoading(true);
    setError("");
    try {
      setRows(await fetchAll(term));
      setApplied(term);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }

  useEffect(() => {
    load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="card">
      <header className="card-head">
        <h1>Residents</h1>
        <p className="sub">
          {loading ? "Loading…" : `${rows.length} row${rows.length === 1 ? "" : "s"}`}
          {applied ? ` matching “${applied}”` : ""}
        </p>
      </header>

      {error && <div className="flash flash-error">{error}</div>}

      <form
        className="list-controls"
        onSubmit={(e) => {
          e.preventDefault();
          load(search.trim());
        }}
      >
        <input
          type="text"
          placeholder="Search name, address, phone, email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="submit" className="btn">
          Search
        </button>
        {applied && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setSearch("");
              load("");
            }}
          >
            Clear
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary"
          disabled={loading || rows.length === 0}
          onClick={() => downloadCsv(rows)}
        >
          Export CSV{applied ? " (filtered)" : ""}
        </button>
      </form>

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
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
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
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan="8" className="empty">
                  No residents yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
