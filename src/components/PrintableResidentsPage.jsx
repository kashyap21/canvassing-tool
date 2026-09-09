import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

const COLUMNS = [
  ["street_number", "Street #"],
  ["street_name", "Street Name"],
  ["unit_no", "Unit"],
  ["name", "Name"],
  ["cell_number", "CELL"],
  ["comments", "Comments"],
];

const PRINT_SELECT = "street_number, street_name, unit_no, first_name, last_name, cell_number, comments";

function withName(row) {
  return {
    street_number: row.street_number || "",
    street_name: row.street_name || "",
    unit_no: row.unit_no || "",
    name: [row.first_name, row.last_name].filter(Boolean).join(" "),
    cell_number: row.cell_number || "",
    comments: row.comments || "",
  };
}

function isMissingPrintableRpc(error) {
  return (
    error?.code === "PGRST202" ||
    /printable_residents|schema cache|Could not find the function/i.test(error?.message || "")
  );
}

async function fetchPrintableRows() {
  const { data, error } = await supabase.rpc("printable_residents");
  if (!error) return data || [];
  if (!isMissingPrintableRpc(error)) throw error;

  const fallback = await supabase
    .from("residents")
    .select(PRINT_SELECT)
    .order("street_name", { ascending: true })
    .order("street_number", { ascending: true })
    .order("unit_no", { ascending: true })
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true });
  if (fallback.error) throw fallback.error;
  return (fallback.data || []).map(withName);
}

export default function PrintableResidentsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadPrintableRows() {
      setLoading(true);
      setError("");

      try {
        const printableRows = await fetchPrintableRows();
        if (cancelled) return;
        setRows(printableRows);
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError.message);
        setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadPrintableRows();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="page print-data-page">
      <div className="print-data-actions">
        <a className="btn btn-ghost" href="#/data">
          Back to data
        </a>
        <button type="button" className="btn btn-primary" disabled={loading || rows.length === 0} onClick={() => window.print()}>
          Print
        </button>
      </div>

      <section className="print-data-sheet" aria-label="Printable resident data">
        <header className="print-data-head">
          <h1>Resident Data</h1>
          <p>{loading ? "Loading..." : `${rows.length} resident${rows.length === 1 ? "" : "s"}`}</p>
        </header>

        {error ? <div className="flash flash-error print-data-error">{error}</div> : null}

        {!error && (
          <table className="print-data-table">
            <thead>
              <tr>
                {COLUMNS.map(([, label]) => (
                  <th key={label} scope="col">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.street_number}-${row.street_name}-${row.unit_no}-${row.name}-${index}`}>
                  {COLUMNS.map(([key]) => (
                    <td key={key}>{row[key] || ""}</td>
                  ))}
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="empty">
                    No residents yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
