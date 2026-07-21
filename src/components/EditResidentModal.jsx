import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

const SUPPORTER_CHOICES = [
  ["yes", "Yes"],
  ["no", "No"],
  ["unknown", "Unknown"],
];

const NA_FIELDS = ["first_name", "last_name", "cell_number", "email"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Only these columns are user-editable; id / created_at are left untouched.
const EDITABLE = [
  "street_number",
  "street_name",
  "unit_no",
  "first_name",
  "last_name",
  "cell_number",
  "email",
  "supporter",
  "number_of_votes",
  "lawn_sign",
  "newsletter_consent",
  "comments",
];

function toForm(resident) {
  const v = {};
  for (const k of EDITABLE) {
    const raw = resident[k];
    v[k] = raw == null ? (k === "number_of_votes" ? 0 : "") : raw;
  }
  return v;
}

export default function EditResidentModal({ resident, streets, onClose, onSaved }) {
  const [values, setValues] = useState(() => toForm(resident));
  const [nameNa, setNameNa] = useState(resident.first_name === "N/A");
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  // Re-seed the form if a different resident is opened without unmounting.
  useEffect(() => {
    setValues(toForm(resident));
    setNameNa(resident.first_name === "N/A");
    setErrors({});
  }, [resident]);

  // Close on Escape for keyboard users.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function set(field, value) {
    setValues((v) => ({ ...v, [field]: value }));
  }

  function toggleNa(checked) {
    setNameNa(checked);
    if (checked) {
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
    if (!String(values.street_number).trim()) e.street_number = "This field is required.";
    if (!String(values.street_name).trim()) e.street_name = "This field is required.";
    if (!nameNa) {
      if (!String(values.first_name).trim()) e.first_name = "This field is required.";
      // Last name, cell number and email are optional here.
      if (String(values.email).trim() && !EMAIL_RE.test(String(values.email).trim()))
        e.email = "Enter a valid email address.";
    }
    if (values.number_of_votes === "" || Number(values.number_of_votes) < 0)
      e.number_of_votes = "Enter 0 or more.";
    return e;
  }

  async function submit(ev) {
    ev.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) return;

    setSaving(true);
    const payload = {
      ...values,
      number_of_votes: Number(values.number_of_votes) || 0,
      ...(nameNa ? { first_name: "N/A", last_name: "N/A", cell_number: "N/A", email: "N/A" } : {}),
    };

    const { data, error } = await supabase
      .from("residents")
      .update(payload)
      .eq("id", resident.id)
      .select()
      .single();
    setSaving(false);

    if (error) {
      setErrors({ _form: error.message });
      return;
    }

    onSaved(data);
  }

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Edit resident"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>Edit resident</h2>
          <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>

        {errors._form && <div className="flash flash-error">{errors._form}</div>}

        <form className="form-grid" onSubmit={submit} noValidate>
          <div className="field field-narrow">
            <label htmlFor="e_street_number">Street number</label>
            <input
              id="e_street_number"
              type="text"
              inputMode="numeric"
              value={values.street_number}
              onChange={(e) => set("street_number", e.target.value)}
            />
            {errors.street_number && <span className="err">{errors.street_number}</span>}
          </div>
          <div className="field">
            <label htmlFor="e_street_name">Street name</label>
            <input
              id="e_street_name"
              type="text"
              list="edit-street-options"
              autoComplete="off"
              value={values.street_name}
              onChange={(e) => set("street_name", e.target.value)}
            />
            <datalist id="edit-street-options">
              {(streets || []).map((s) => (
                <option value={s} key={s} />
              ))}
            </datalist>
            {errors.street_name && <span className="err">{errors.street_name}</span>}
          </div>

          <div className="field col-full">
            <label htmlFor="e_unit_no">
              Unit no. <span className="opt">(optional)</span>
            </label>
            <input
              id="e_unit_no"
              type="text"
              value={values.unit_no}
              onChange={(e) => set("unit_no", e.target.value)}
            />
          </div>

          <label className="na-check col-full">
            <input type="checkbox" checked={nameNa} onChange={(e) => toggleNa(e.target.checked)} />
            <span>No details given — mark name, phone &amp; email as N/A</span>
          </label>

          <div className="field">
            <label htmlFor="e_first_name">First name</label>
            <input
              id="e_first_name"
              type="text"
              className={nameNa ? "is-na" : ""}
              readOnly={nameNa}
              value={values.first_name}
              onChange={(e) => set("first_name", e.target.value)}
            />
            {errors.first_name && <span className="err">{errors.first_name}</span>}
          </div>
          <div className="field">
            <label htmlFor="e_last_name">
              Last name <span className="opt">(optional)</span>
            </label>
            <input
              id="e_last_name"
              type="text"
              className={nameNa ? "is-na" : ""}
              readOnly={nameNa}
              value={values.last_name}
              onChange={(e) => set("last_name", e.target.value)}
            />
            {errors.last_name && <span className="err">{errors.last_name}</span>}
          </div>

          <div className="field">
            <label htmlFor="e_cell_number">
              Cell number <span className="opt">(optional)</span>
            </label>
            <input
              id="e_cell_number"
              type="tel"
              inputMode="tel"
              className={nameNa ? "is-na" : ""}
              readOnly={nameNa}
              value={values.cell_number}
              onChange={(e) => set("cell_number", e.target.value)}
            />
            {errors.cell_number && <span className="err">{errors.cell_number}</span>}
          </div>
          <div className="field">
            <label htmlFor="e_email">
              Email <span className="opt">(optional)</span>
            </label>
            <input
              id="e_email"
              type="email"
              className={nameNa ? "is-na" : ""}
              readOnly={nameNa}
              value={values.email}
              onChange={(e) => set("email", e.target.value)}
            />
            {errors.email && <span className="err">{errors.email}</span>}
          </div>

          <div className="field">
            <label>Supporter?</label>
            <div className="radios">
              {SUPPORTER_CHOICES.map(([val, label]) => (
                <label className="radio-pill" key={val}>
                  <input
                    type="radio"
                    name="edit-supporter"
                    value={val}
                    checked={values.supporter === val}
                    onChange={(e) => set("supporter", e.target.value)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="field">
            <label htmlFor="e_number_of_votes">Number of votes</label>
            <input
              id="e_number_of_votes"
              type="number"
              min="0"
              step="1"
              className="field-narrow"
              value={values.number_of_votes}
              onChange={(e) => set("number_of_votes", e.target.value)}
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
                checked={!!values.lawn_sign}
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
                checked={!!values.newsletter_consent}
                onChange={(e) => set("newsletter_consent", e.target.checked)}
              />
              <span className="slider" />
            </span>
          </label>

          <div className="field col-full">
            <label htmlFor="e_comments">
              Other comments <span className="opt">(optional)</span>
            </label>
            <textarea
              id="e_comments"
              rows="4"
              value={values.comments}
              onChange={(e) => set("comments", e.target.value)}
            />
          </div>

          <div className="modal-actions col-full">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
