import { useState } from "react";
import { supabase } from "../supabaseClient";

// Simple email + password sign-in. Create your canvassers' logins in the
// Supabase dashboard (Authentication -> Users -> Add user), or leave sign-ups
// enabled and let them register once.
export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setBusy(false);
  }

  return (
    <div className="card">
      <header className="card-head">
        <h1>Sign in</h1>
        <p className="sub">Canvassers sign in to record residents.</p>
      </header>

      {error && <div className="flash flash-error">{error}</div>}

      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="login-email">Email</label>
          <input
            id="login-email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <button type="submit" className="save" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
