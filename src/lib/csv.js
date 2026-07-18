// Column order + friendly headers for the CSV export (mirrors the Django admin
// export so the two tools produce the same file).
export const CSV_COLUMNS = [
  ["id", "Id"],
  ["created_at", "Created At"],
  ["first_name", "First Name"],
  ["last_name", "Last Name"],
  ["street_number", "Street Number"],
  ["street_name", "Street Name"],
  ["unit_no", "Unit No."],
  ["cell_number", "Cell Number"],
  ["email", "Email"],
  ["supporter", "Supporter"],
  ["number_of_votes", "Number Of Votes"],
  ["lawn_sign", "Wants A Lawn Sign"],
  ["newsletter_consent", "Agrees To Receive Further Communication / Newsletter / Updates"],
  ["comments", "Other Comments"],
];

const SUPPORTER_LABELS = { yes: "Yes", no: "No", unknown: "Unknown" };

function cell(row, key) {
  const value = row[key];
  if (key === "supporter") return SUPPORTER_LABELS[value] || value || "";
  if (key === "lawn_sign" || key === "newsletter_consent") return value ? "Yes" : "No";
  if (key === "created_at" && value) {
    // Local date/time, e.g. 2026-07-18 18:59
    const d = new Date(value);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return value == null ? "" : String(value);
}

// RFC-4180 quoting: wrap in quotes and double any internal quotes.
function quote(text) {
  if (/[",\n\r]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

export function residentsToCsv(rows) {
  const header = CSV_COLUMNS.map(([, label]) => quote(label)).join(",");
  const body = rows
    .map((row) => CSV_COLUMNS.map(([key]) => quote(cell(row, key))).join(","))
    .join("\r\n");
  return header + "\r\n" + body + "\r\n";
}

export function downloadCsv(rows) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  // Prepend a BOM so Excel opens UTF-8 correctly.
  const blob = new Blob(["﻿" + residentsToCsv(rows)], {
    type: "text/csv;charset=utf-8;",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `residents_${stamp}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}
