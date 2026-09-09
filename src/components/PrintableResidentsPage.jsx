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

export default function PrintableResidentsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadPrintableRows() {
      setLoading(true);
      setError("");

      const { data, error: rpcError } = await supabase.rpc("printable_residents");
      if (cancelled) return;

      if (rpcError) {
        setError(rpcError.message);
        setRows([]);
      } else {
        setRows(data || []);
      }
      setLoading(false);
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
