import { useCallback, useEffect, useState } from "react";
import { supabase, isConfigured } from "./supabaseClient";
import Login from "./components/Login";
import ResidentForm from "./components/ResidentForm";
import ResidentsList from "./components/ResidentsList";

export default function App() {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState("add"); // "add" | "data"

  // Data the form needs: known streets, header counters, recent entries.
  const [streets, setStreets] = useState([]);
  const [stats, setStats] = useState({ total_residents: 0, total_votes: 0 });
  const [recent, setRecent] = useState([]);

  // Track the signed-in session (and react to sign-in / sign-out).
  useEffect(() => {
    if (!isConfigured) {
      setReady(true);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const refresh = useCallback(async () => {
    if (!session) return;
    const [streetsRes, statsRes, recentRes] = await Promise.all([
      supabase.rpc("distinct_streets"),
      supabase.rpc("resident_stats"),
      supabase
        .from("residents")
        .select("id, first_name, last_name, street_number, street_name, unit_no, number_of_votes")
        .order("created_at", { ascending: false })
        .limit(8),
    ]);
    setStreets((streetsRes.data || []).map((r) => r.street_name));
    if (statsRes.data && statsRes.data[0]) setStats(statsRes.data[0]);
    setRecent(recentRes.data || []);
  }, [session]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!isConfigured) {
    return (
      <main className="page page-narrow">
        <div className="card">
          <header className="card-head">
            <h1>Set up Supabase</h1>
          </header>
          <p className="sub">
            Copy <code>.env.example</code> to <code>.env</code>, fill in
            <code> VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> from your
            Supabase project (Settings → API), then restart the dev server.
          </p>
        </div>
      </main>
    );
  }

  if (!ready) {
    return (
      <main className="page page-narrow">
        <div className="card">
          <p className="sub">Loading…</p>
        </div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="page page-narrow">
        <Login />
      </main>
    );
  }

  return (
    <main className="page">
      <nav className="topbar">
        <div className="tabs">
          <button
            className={view === "add" ? "tab active" : "tab"}
            onClick={() => setView("add")}
          >
            Add
          </button>
          <button
            className={view === "data" ? "tab active" : "tab"}
            onClick={() => setView("data")}
          >
            Data
          </button>
        </div>
        <button className="signout" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </nav>

      {view === "add" ? (
        <ResidentForm streets={streets} stats={stats} recent={recent} onSaved={refresh} />
      ) : (
        <ResidentsList />
      )}
    </main>
  );
}
