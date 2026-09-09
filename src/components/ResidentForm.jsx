import { useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { isRetryableNetworkError, queueResident } from "../lib/offlineQueue";
import { normalizePhone, normalizeResidentPayload } from "../lib/normalizeResident";
import { findAddressMatches, formatAddress, meaningful, normalizeStreetNumber } from "../lib/duplicates";
import StreetAutocomplete from "./StreetAutocomplete";
import EditResidentModal from "./EditResidentModal";

const SUPPORTER_CHOICES = [
  ["yes", "Yes"],
  ["no", "No"],
  ["unknown", "Unknown"],
];

const NA_FIELDS = ["first_name", "last_name", "cell_number", "email"];

const EMPTY = {
  street_number: "",
  street_name: "",
  unit_no: "",
  first_name: "",
  last_name: "",
  cell_number: "",
  email: "",
  supporter: "unknown",
  // An unknown door starts at 0 — nothing is counted until someone says yes.
  number_of_votes: 0,
  lawn_sign: false,
  newsletter_consent: false,
  comments: "",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const residentName = (r) => [r.first_name, r.last_name].filter(Boolean).join(" ");

// Columns the duplicate check needs to describe a match back to the user.
const DUP_FIELDS =
  "id, street_number, street_name, unit_no, first_name, last_name, cell_number, supporter, number_of_votes, created_at";
// Anything outside this set could carry LIKE wildcards, so match it exactly.
const PLAIN_NUMBER_RE = /^[A-Za-z0-9\s/-]+$/;
const NO_MATCHES = { exact: [], otherUnits: [] };

function matchLabel(row) {
  const name = residentName(row).trim();
  const bits = [name || "no name recorded"];
  if (row.supporter && row.supporter !== "unknown")
    bits.push(`supporter: ${row.supporter === "yes" ? "yes" : "no"}`);
  if (meaningful(row.cell_number)) bits.push(row.cell_number);
  return bits.join(" · ");
}

export default function ResidentForm({ streets, recent, onSaved, online }) {
  const [values, setValues] = useState(EMPTY);
  const [nameNa, setNameNa] = useState(false);
  const [errors, setErrors] = useState({});
  const [flash, setFlash] = useState("");
  const [saving, setSaving] = useState(false);

  // Live duplicate check on the address (feature request #3).
  const [dup, setDup] = useState(NO_MATCHES);
  const [dupChecking, setDupChecking] = useState(false);
  const [dupBlocked, setDupBlocked] = useState(false);
  const dupRequestRef = useRef(0);

  // The supporter answer and the voter count fill each other in, so a fast
  // typist only has to enter one of them. Whichever field the canvasser touches
  // wins: a hand-entered "3" is never overwritten by a later change of
  // supporter, and a deliberate Yes/No is never overwritten by a typed count.
  const [votesEdited, setVotesEdited] = useState(false);
  const [supporterEdited, setSupporterEdited] = useState(false);

  // The row open in the edit dialog, opened from "Recently added".
  const [editing, setEditing] = useState(null);

  // Ask the database whether this address is already recorded, ~1/3 s after the
  // typist stops. Only rows with the same street number come back, so this stays
  // a small query however big the table gets.
  useEffect(() => {
    const { street_number: number, street_name: name, unit_no: unit } = values;
    const requestId = ++dupRequestRef.current;
    setDupBlocked(false);

    if (!online || !normalizeStreetNumber(number) || !name.trim()) {
      setDup(NO_MATCHES);
      setDupChecking(false);
      return;
    }

    setDupChecking(true);
    const timer = setTimeout(async () => {
      const trimmed = number.trim();
      const query = supabase.from("residents").select(DUP_FIELDS);
      // ilike catches "12A" vs "12a"; a value with LIKE wildcards in it is
      // matched literally instead.
      const filtered = PLAIN_NUMBER_RE.test(trimmed)
        ? query.ilike("street_number", trimmed)
        : query.eq("street_number", trimmed);
      const { data, error } = await filtered.limit(200);

      if (requestId !== dupRequestRef.current) return; // a newer keystroke won
      setDupChecking(false);
      if (error) {
        setDup(NO_MATCHES);
        return;
      }
      setDup(
        findAddressMatches(data || [], {
          street_number: number,
          street_name: name,
          unit_no: unit,
        }),
      );
    }, 350);

    return () => clearTimeout(timer);
  }, [values.street_number, values.street_name, values.unit_no, online]);

  function set(field, value) {
    setValues((v) => ({ ...v, [field]: value }));
  }

  function setSupporter(value) {
    setSupporterEdited(true);
    setValues((v) => ({
      ...v,
      supporter: value,
      // 1 once they say yes, 0 for a no or an unknown door.
      ...(votesEdited ? {} : { number_of_votes: value === "yes" ? 1 : 0 }),
    }));
  }

  function setVotes(raw) {
    setVotesEdited(true);
    setValues((v) => ({
      ...v,
      number_of_votes: raw,
      // Typing a count is itself an answer to "Supporter?", so fill it in and
      // save the click. An explicit choice is left alone — a deliberate "No"
      // next to a count is a contradiction only the canvasser can settle.
      ...(!supporterEdited && Number(raw) > 0 ? { supporter: "yes" } : {}),
    }));
  }

  // Back to a blank door, ready for the next one.
  function resetForm() {
    setValues(EMPTY);
    setNameNa(false);
    setErrors({});
    setVotesEdited(false);
    setSupporterEdited(false);
    document.getElementById("street_number")?.focus();
  }

  function toggleNa(checked) {
    setNameNa(checked);
    if (checked) {
      // Stamp name / phone / email with "N/A" and clear any errors on them.
      setValues((v) => ({ ...v, first_name: "N/A", last_name: "N/A", cell_number: "N/A", email: "N/A" }));
      setErrors((e) => {
        const next = { ...e };
        NA_FIELDS.forEach((f) => delete next[f]);
        return next;
      });
    } else {
      setValues((v) => ({
        ...v,
        first_name: v.first_name === "N/A" ? "" : v.first_name,
        last_name: v.last_name === "N/A" ? "" : v.last_name,
        cell_number: v.cell_number === "N/A" ? "" : v.cell_number,
        email: v.email === "N/A" ? "" : v.email,
      }));
    }
  }

  function validate() {
    const e = {};
    if (!values.street_number.trim()) e.street_number = "This field is required.";
    if (!values.street_name.trim()) e.street_name = "This field is required.";
    if (!nameNa) {
      // Name, phone number and email are optional.
      if (values.email.trim() && !EMAIL_RE.test(values.email.trim()))
        e.email = "Enter a valid email address.";
    }
    if (values.number_of_votes === "" || Number(values.number_of_votes) < 0)
      e.number_of_votes = "Enter 0 or more.";
    return e;
  }

  async function submit(ev, { force = false } = {}) {
    ev.preventDefault();
    setFlash("");
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) return;

    // First attempt on an address that already exists: stop and make the typist
    // look at the matches. A second click ("Save anyway") goes through.
    if (dup.exact.length && !force) {
      setDupBlocked(true);
      document.getElementById("dup-warning")?.scrollIntoView({ block: "center" });
      return;
    }

    const payload = {
      ...normalizeResidentPayload(values),
      number_of_votes: Number(values.number_of_votes) || 0,
      // N/A path: force the four fields regardless of what's shown.
      ...(nameNa ? { first_name: "N/A", last_name: "N/A", cell_number: "N/A", email: "N/A" } : {}),
    };

    if (!online) {
      queueResident(payload);
      setFlash("Saved offline. It will sync automatically when this device is online.");
      resetForm();
      return;
    }

    setSaving(true);
    const { error } = await supabase.from("residents").insert(payload);
    setSaving(false);

    if (error) {
      if (isRetryableNetworkError(error)) {
        queueResident(payload);
        setFlash("Saved offline. It will sync automatically when this device is online.");
        resetForm();
        return;
      }

      setFlash("");
      setErrors({ _form: error.message });
      return;
    }

    const displayName = [payload.first_name, payload.last_name].filter(Boolean).join(" ").trim();
    const displayAddress = [payload.street_number, payload.street_name].filter(Boolean).join(" ").trim();
    setFlash(`Saved ${displayName || displayAddress || "resident"}.`);
    // Also returns focus to the first field, for fast repeat entry.
    resetForm();
    onSaved(); // refresh streets / stats / recent
  }

  return (
    <>
      <div className="card">
        <header className="card-head">
          <h1>Add a Resident</h1>
          <p className="sub">Fill in what you learned at the door. Only the address is required.</p>
        </header>

        {flash && <div className="flash flash-success">✓ {flash}</div>}
        {errors._form && <div className="flash flash-error">{errors._form}</div>}

        <form className="form-grid" onSubmit={submit} noValidate>
          {/* One address line: number, street, unit. On a phone the labels wrap
              to two lines rather than shrinking the boxes. */}
          <div className="address-row col-full">
            <div className="field">
              <label htmlFor="street_number">Street number</label>
              <input
                id="street_number"
                type="text"
                inputMode="numeric"
                placeholder="123"
                autoFocus
                value={values.street_number}
                onChange={(e) => set("street_number", e.target.value)}
              />
              {errors.street_number && <span className="err">{errors.street_number}</span>}
            </div>
            <div className="field">
              <label htmlFor="street_name">Street name</label>
              <StreetAutocomplete
                id="street_name"
                listId="street-options"
                placeholder="e.g. Maple Street"
                streets={streets}
                value={values.street_name}
                onChange={(v) => set("street_name", v)}
              />
              {errors.street_name && <span className="err">{errors.street_name}</span>}
            </div>
            <div className="field">
              <label htmlFor="unit_no">
                Unit no. <span className="opt">(opt.)</span>
              </label>
              <input
                id="unit_no"
                type="text"
                placeholder="Apt"
                value={values.unit_no}
                onChange={(e) => set("unit_no", e.target.value)}
              />
            </div>
          </div>
          <span className="hint col-full">
            Street name: start typing — streets you entered before will appear.
          </span>

          {dupChecking && dup.exact.length === 0 && (
            <p className="dup-checking col-full">Checking for duplicates…</p>
          )}

          {dup.exact.length > 0 && (
            <div
              id="dup-warning"
              className={dupBlocked ? "dup-alert col-full is-blocking" : "dup-alert col-full"}
              role="alert"
            >
              <strong>
                ⚠ This address is already in the system — {dup.exact.length} entr
                {dup.exact.length === 1 ? "y" : "ies"} at {formatAddress(dup.exact[0])}
              </strong>
              <ul className="dup-list">
                {dup.exact.slice(0, 6).map((r) => (
                  <li key={r.id}>
                    <span className="dup-who">{matchLabel(r)}</span>
                    <span className="dup-when">{new Date(r.created_at).toLocaleDateString()}</span>
                  </li>
                ))}
              </ul>
              {dup.exact.length > 6 && <p className="dup-more">…and {dup.exact.length - 6} more.</p>}
              <p className="dup-help">
                {dupBlocked
                  ? "If this really is a different person at the same address, use Save anyway."
                  : "Only add this if it is a different person at the same address."}
              </p>
            </div>
          )}

          {dup.exact.length === 0 && dup.otherUnits.length > 0 && (
            <p className="dup-note col-full">
              {dup.otherUnits.length} other unit{dup.otherUnits.length === 1 ? "" : "s"} recorded at
              this street address (
              {dup.otherUnits
                .slice(0, 6)
                .map((r) => (meaningful(r.unit_no) ? `#${r.unit_no}` : "no unit"))
                .join(", ")}
              ).
            </p>
          )}

          <label className="na-check col-full">
            <input type="checkbox" checked={nameNa} onChange={(e) => toggleNa(e.target.checked)} />
            <span>No details given — mark name, phone &amp; email as N/A</span>
          </label>

          {/* Name, name, phone across one line — the same order as the paper
              tables, so a typist reads straight across instead of tabbing down
              a stack. On a phone the cell number drops to its own line. */}
          <div className="name-row col-full">
            <div className="field">
              <label htmlFor="first_name">
                First name <span className="opt">(optional)</span>
              </label>
              <input
                id="first_name"
                type="text"
                placeholder="First name"
                className={nameNa ? "is-na" : ""}
                readOnly={nameNa}
                value={values.first_name}
                onChange={(e) => set("first_name", e.target.value)}
              />
              {errors.first_name && <span className="err">{errors.first_name}</span>}
            </div>
            <div className="field">
              <label htmlFor="last_name">
                Last name <span className="opt">(optional)</span>
              </label>
              <input
                id="last_name"
                type="text"
                placeholder="Last name"
                className={nameNa ? "is-na" : ""}
                readOnly={nameNa}
                value={values.last_name}
                onChange={(e) => set("last_name", e.target.value)}
              />
              {errors.last_name && <span className="err">{errors.last_name}</span>}
            </div>
            <div className="field">
              <label htmlFor="cell_number">
                Cell number <span className="opt">(optional)</span>
              </label>
              <input
                id="cell_number"
                type="tel"
                inputMode="tel"
                placeholder="555-123-4567"
                className={nameNa ? "is-na" : ""}
                readOnly={nameNa}
                value={values.cell_number}
                onChange={(e) => set("cell_number", e.target.value)}
                // Snap to 555-123-4567 as soon as they leave the field, so the
                // stored format is visible at the door and not a save-time surprise.
                onBlur={(e) => set("cell_number", normalizePhone(e.target.value))}
              />
              {errors.cell_number && <span className="err">{errors.cell_number}</span>}
            </div>
          </div>

          <div className="field">
            <label>Supporter?</label>
            <div className="radios">
              {SUPPORTER_CHOICES.map(([val, label]) => (
                <label className="radio-pill" key={val}>
                  <input
                    type="radio"
                    name="supporter"
                    value={val}
                    checked={values.supporter === val}
                    onChange={(e) => setSupporter(e.target.value)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="field">
            <label htmlFor="number_of_votes">Number of voters</label>
            <input
              id="number_of_votes"
              type="number"
              min="0"
              step="1"
              className="field-narrow"
              value={values.number_of_votes}
              onChange={(e) => setVotes(e.target.value)}
            />
            {errors.number_of_votes && <span className="err">{errors.number_of_votes}</span>}
          </div>

          <label className="toggle col-full">
            <span className="toggle-text">
              <span className="toggle-title">Lawn sign</span>
              <span className="toggle-desc">Do they want a sign on their lawn?</span>
            </span>
            <span className="switch">
              <input
                type="checkbox"
                checked={values.lawn_sign}
                onChange={(e) => set("lawn_sign", e.target.checked)}
              />
              <span className="slider" />
            </span>
          </label>

          <label className="toggle col-full">
            <span className="toggle-text">
              <span className="toggle-title">Further communication</span>
              <span className="toggle-desc">Agrees to receive news, newsletters &amp; updates?</span>
            </span>
            <span className="switch">
              <input
                type="checkbox"
                checked={values.newsletter_consent}
                onChange={(e) => set("newsletter_consent", e.target.checked)}
              />
              <span className="slider" />
            </span>
          </label>

          {/* Email sits after the toggles: it isn't a column on the paper
              tables and is rarely given, so it stays out of the tab path
              through the fields that are filled in at every door. */}
          <div className="field col-full">
            <label htmlFor="email">
              Email <span className="opt">(optional)</span>
            </label>
            <input
              id="email"
              type="email"
              placeholder="name@example.com (optional)"
              className={nameNa ? "is-na" : ""}
              readOnly={nameNa}
              value={values.email}
              onChange={(e) => set("email", e.target.value)}
            />
            {errors.email && <span className="err">{errors.email}</span>}
          </div>

          <div className="field col-full">
            <label htmlFor="comments">
              Other comments <span className="opt">(optional)</span>
            </label>
            <textarea
              id="comments"
              rows="6"
              placeholder="Anything else worth noting (optional)"
              value={values.comments}
              onChange={(e) => set("comments", e.target.value)}
            />
          </div>

          {dupBlocked ? (
            <div className="save-row col-full">
              <button
                type="button"
                className="save save-warn"
                disabled={saving}
                onClick={(e) => submit(e, { force: true })}
              >
                {saving ? "Saving…" : "Save anyway"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={saving}
                onClick={() => {
                  setDupBlocked(false);
                  resetForm();
                }}
              >
                Skip this one
              </button>
            </div>
          ) : (
            <button type="submit" className="save col-full" disabled={saving}>
              {saving ? "Saving…" : "Save resident"}
            </button>
          )}
        </form>
      </div>

      {recent.length > 0 && (
        <div className="card recent">
          <h2>Recently added</h2>
          <ul>
            {recent.map((r) => (
              <li key={r.id}>
                <span className="r-name">
                  {residentName(r)}
                </span>
                <span className="r-addr">
                  {r.street_number} {r.street_name}
                  {r.unit_no ? ` · #${r.unit_no}` : ""}
                </span>
                <span className="r-votes">
                  {r.number_of_votes} voter{r.number_of_votes === 1 ? "" : "s"}
                </span>
                {/* Fix a typo in the entry you just made without going to the
                    Data page and hunting for the address. */}
                <button
                  type="button"
                  className="btn btn-edit r-edit"
                  disabled={!online}
                  onClick={() => setEditing(r)}
                >
                  Edit
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {editing && (
        <EditResidentModal
          resident={editing}
          streets={streets}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setEditing(null);
            setFlash(`Saved changes to ${residentName(updated) || "the entry"}.`);
            onSaved(); // pull the corrected row back into the list and the stats
          }}
        />
      )}
    </>
  );
}
