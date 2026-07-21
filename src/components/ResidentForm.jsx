import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

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
  number_of_votes: 1,
  lawn_sign: false,
  newsletter_consent: false,
  comments: "",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const residentName = (r) => [r.first_name, r.last_name].filter(Boolean).join(" ");

export default function ResidentForm({ streets, stats, recent, onSaved }) {
  const [values, setValues] = useState(EMPTY);
  const [nameNa, setNameNa] = useState(false);
  const [errors, setErrors] = useState({});
  const [flash, setFlash] = useState("");
  const [saving, setSaving] = useState(false);

  // Live street type-ahead: refine the <datalist> from the DB as the user types.
  const [streetOptions, setStreetOptions] = useState(streets);
  useEffect(() => setStreetOptions(streets), [streets]);

  useEffect(() => {
    const q = values.street_name.trim().toLowerCase();
    if (q.length < 2) {
      setStreetOptions(streets);
      return;
    }
    const timer = setTimeout(() => {
      setStreetOptions(streets.filter((s) => s.toLowerCase().includes(q)).slice(0, 10));
    }, 200);
    return () => clearTimeout(timer);
  }, [values.street_name, streets]);

  function set(field, value) {
    setValues((v) => ({ ...v, [field]: value }));
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

  async function submit(ev) {
    ev.preventDefault();
    setFlash("");
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) return;

    setSaving(true);
    const payload = {
      ...values,
      number_of_votes: Number(values.number_of_votes) || 0,
      // N/A path: force the four fields regardless of what's shown.
      ...(nameNa ? { first_name: "N/A", last_name: "N/A", cell_number: "N/A", email: "N/A" } : {}),
    };

    const { error } = await supabase.from("residents").insert(payload);
    setSaving(false);

    if (error) {
      setFlash("");
      setErrors({ _form: error.message });
      return;
    }

    const displayName = [payload.first_name, payload.last_name].filter(Boolean).join(" ").trim();
    const displayAddress = [payload.street_number, payload.street_name].filter(Boolean).join(" ").trim();
    setFlash(`Saved ${displayName || displayAddress || "resident"}.`);
    setValues(EMPTY);
    setNameNa(false);
    setErrors({});
    onSaved(); // refresh streets / stats / recent
    // Return focus to the first field for fast repeat entry.
    document.getElementById("street_number")?.focus();
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

        <div className="stats">
          <div className="stat">
            <span className="stat-num">{stats.total_residents}</span>
            <span className="stat-label">Residents</span>
          </div>
          <div className="stat">
            <span className="stat-num">{stats.total_votes}</span>
            <span className="stat-label">Votes</span>
          </div>
        </div>

        <form className="form-grid" onSubmit={submit} noValidate>
          <div className="field field-narrow">
            <label htmlFor="street_number">Street number</label>
            <input
              id="street_number"
              type="text"
              inputMode="numeric"
              placeholder="e.g. 123"
              autoFocus
              value={values.street_number}
              onChange={(e) => set("street_number", e.target.value)}
            />
            {errors.street_number && <span className="err">{errors.street_number}</span>}
          </div>
          <div className="field">
            <label htmlFor="street_name">Street name</label>
            <input
              id="street_name"
              type="text"
              list="street-options"
              autoComplete="off"
              placeholder="e.g. Maple Street"
              value={values.street_name}
              onChange={(e) => set("street_name", e.target.value)}
            />
            <datalist id="street-options">
              {streetOptions.map((s) => (
                <option value={s} key={s} />
              ))}
            </datalist>
            <span className="hint">Start typing — streets you entered before will appear.</span>
            {errors.street_name && <span className="err">{errors.street_name}</span>}
          </div>

          <div className="field col-full">
            <label htmlFor="unit_no">
              Unit no. <span className="opt">(optional)</span>
            </label>
            <input
              id="unit_no"
              type="text"
              placeholder="Apt / unit (optional)"
              value={values.unit_no}
              onChange={(e) => set("unit_no", e.target.value)}
            />
          </div>

          <label className="na-check col-full">
            <input type="checkbox" checked={nameNa} onChange={(e) => toggleNa(e.target.checked)} />
            <span>No details given — mark name, phone &amp; email as N/A</span>
          </label>

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
              placeholder="(555) 123-4567"
              className={nameNa ? "is-na" : ""}
              readOnly={nameNa}
              value={values.cell_number}
              onChange={(e) => set("cell_number", e.target.value)}
            />
            {errors.cell_number && <span className="err">{errors.cell_number}</span>}
          </div>
          <div className="field">
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
                    onChange={(e) => set("supporter", e.target.value)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="field">
            <label htmlFor="number_of_votes">Number of votes</label>
            <input
              id="number_of_votes"
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

          <button type="submit" className="save col-full" disabled={saving}>
            {saving ? "Saving…" : "Save resident"}
          </button>
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
                  {r.number_of_votes} vote{r.number_of_votes === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
