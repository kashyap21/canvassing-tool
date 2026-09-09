const SHEET_ROWS = 8;

const COLUMNS = [
  { key: "street_number", label: "Street #", className: "sheet-street-number" },
  { key: "street_name", label: "Street Name", className: "sheet-street-name" },
  { key: "first_name", label: "First Name", className: "sheet-first-name" },
  { key: "last_name", label: "Last Name", className: "sheet-last-name" },
  { key: "phone_number", label: "Phone Number", className: "sheet-phone" },
  { key: "voters", label: "# of Voters", className: "sheet-voters" },
  { key: "lawn_sign", label: "Lawn Sign", className: "sheet-lawn-sign" },
];

export default function PrintableCanvassSheet() {
  return (
    <section className="print-sheet" aria-label="Blank canvassing data entry sheet">
      <header className="print-sheet-head">
        <h1>Canvassing Data Entry</h1>
        <div className="print-sheet-meta">
          <span>Date:</span>
          <span>Street Name:</span>
        </div>
      </header>

      <table className="print-sheet-table">
        <colgroup>
          {COLUMNS.map((column) => (
            <col key={column.key} className={column.className} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th key={column.key} scope="col">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: SHEET_ROWS }, (_, row) => (
            <tr key={row}>
              {COLUMNS.map((column) => (
                <td key={column.key}>
                  {column.key === "phone_number" ? (
                    <span className="print-phone-format" aria-hidden="true">
                      <span />
                      <strong>-</strong>
                      <span />
                      <strong>-</strong>
                      <span />
                    </span>
                  ) : null}
                  {column.key === "lawn_sign" ? <span className="print-checkbox" /> : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <section className="print-notes-box" aria-label="Notes and follow-up">
        <h2>Notes / Follow-up</h2>
      </section>
    </section>
  );
}
