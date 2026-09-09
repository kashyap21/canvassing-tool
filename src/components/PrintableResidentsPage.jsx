import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { normalizeStreetPart } from "../lib/normalizeResident";

const COLUMNS = [
  ["street_number", "Street #"],
  ["street_name", "Street Name"],
  ["unit_no", "Unit"],
  ["name", "Name"],
  ["cell_number", "CELL"],
  ["comments", "Comments"],
];

const PAGE = 1000;
const PRINT_SELECT =
  "street_number, street_name, unit_no, first_name, last_name, cell_number, email, supporter, lawn_sign, comments";
const SUPPORTER_LABELS = { yes: "Yes", no: "No", unknown: "Unknown" };
const ADDRESS_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

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

function currentParams() {
  const hash = window.location.hash || "";
  const hashQuery = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  return new URLSearchParams(hashQuery || window.location.search);
}

function residentName(row) {
  return [row.first_name, row.last_name].filter(Boolean).join(" ");
}

function sortByAddress(a, b) {
  return (
    ADDRESS_COLLATOR.compare(normalizeStreetPart(a.street_name), normalizeStreetPart(b.street_name)) ||
    ADDRESS_COLLATOR.compare(normalizeStreetPart(a.street_number), normalizeStreetPart(b.street_number)) ||
    ADDRESS_COLLATOR.compare(normalizeStreetPart(a.unit_no), normalizeStreetPart(b.unit_no)) ||
    ADDRESS_COLLATOR.compare(a.last_name || "", b.last_name || "") ||
    ADDRESS_COLLATOR.compare(a.first_name || "", b.first_name || "")
  );
}

function sortByStreetNumber(a, b) {
  return (
    ADDRESS_COLLATOR.compare(normalizeStreetPart(a.street_number), normalizeStreetPart(b.street_number)) ||
    ADDRESS_COLLATOR.compare(normalizeStreetPart(a.street_name), normalizeStreetPart(b.street_name)) ||
    ADDRESS_COLLATOR.compare(normalizeStreetPart(a.unit_no), normalizeStreetPart(b.unit_no)) ||
    ADDRESS_COLLATOR.compare(a.last_name || "", b.last_name || "") ||
    ADDRESS_COLLATOR.compare(a.first_name || "", b.first_name || "")
  );
}

const SORTERS = {
  street_number: sortByStreetNumber,
  street_name: sortByAddress,
  unit_no: (a, b) => ADDRESS_COLLATOR.compare(normalizeStreetPart(a.unit_no), normalizeStreetPart(b.unit_no)),
  name: (a, b) => ADDRESS_COLLATOR.compare(residentName(a), residentName(b)),
  cell_number: (a, b) => ADDRESS_COLLATOR.compare(a.cell_number || "", b.cell_number || ""),
  supporter: (a, b) =>
    ADDRESS_COLLATOR.compare(
      SUPPORTER_LABELS[a.supporter] || a.supporter || "",
      SUPPORTER_LABELS[b.supporter] || b.supporter || "",
    ),
  lawn_sign: (a, b) => Number(a.lawn_sign) - Number(b.lawn_sign),
};

function applyPrintFilters(rows) {
  const params = currentParams();
  const search = (params.get("search") || "").trim().toLowerCase();
  const street = params.get("street") || "";
  const supporter = params.get("supporter") || "";
  const sign = params.get("sign") || "";
  const hideNa = params.get("hideNa") === "1";
  const sortKey = params.get("sort") || "street_name";
  const sortDir = params.get("dir") === "desc" ? -1 : 1;

  return rows
    .filter((row) => {
      if (hideNa && row.first_name === "N/A") return false;
      if (street && normalizeStreetPart(row.street_name) !== street) return false;
      if (supporter && row.supporter !== supporter) return false;
      if (sign === "yes" && !row.lawn_sign) return false;
      if (sign === "no" && row.lawn_sign) return false;
      if (search) {
        const hay = [
          row.first_name,
          row.last_name,
          row.street_number,
          row.street_name,
          row.unit_no,
          row.cell_number,
          row.email,
          row.comments,
        ]
          .map((value) => (value == null ? "" : String(value).toLowerCase()))
          .join(" ");
        if (!hay.includes(search)) return false;
      }
      return true;
    })
    .sort((a, b) => ((SORTERS[sortKey]?.(a, b) || sortByAddress(a, b)) * sortDir))
    .map(withName);
}

async function fetchPrintableRows() {
  let from = 0;
  const rows = [];

  for (;;) {
    const { data, error } = await supabase
      .from("residents")
      .select(PRINT_SELECT)
      .order("street_name", { ascending: true })
      .order("street_number", { ascending: true })
      .order("unit_no", { ascending: true })
      .order("last_name", { ascending: true })
      .order("first_name", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;

    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }

  return applyPrintFilters(rows);
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
