import { useCallback, useEffect, useState } from "react";
import { supabase, isConfigured } from "./supabaseClient";
import HeaderStats from "./components/HeaderStats";
import Login from "./components/Login";
import ResidentForm from "./components/ResidentForm";
import ResidentsList from "./components/ResidentsList";
import PrintableResidentsPage from "./components/PrintableResidentsPage";
import { flushPendingResidents, getPendingResidentCount } from "./lib/offlineQueue";

export default function App() {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState("add"); // "add" | "data"
  const [route, setRoute] = useState(() => window.location.hash || "#/");

  // Data the form needs: known streets, header counters, recent entries.
  const [streets, setStreets] = useState([]);
  const [stats, setStats] = useState({ total_residents: 0, total_votes: 0 });
  const [recent, setRecent] = useState([]);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [pendingCount, setPendingCount] = useState(getPendingResidentCount);
  const [syncing, setSyncing] = useState(false);
  const [dataRefreshKey, setDataRefreshKey] = useState(0);

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

  useEffect(() => {
    function handleHashChange() {
      setRoute(window.location.hash || "#/");
    }

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    if (route === "#/data") setView("data");
    if (route === "#/" || route === "#/add") setView("add");
  }, [route]);

  const refresh = useCallback(async () => {
    if (!session) return;
    const [streetsRes, statsRes, recentRes] = await Promise.all([
      supabase.rpc("distinct_streets"),
      supabase.rpc("resident_stats"),
      supabase
        .from("residents")
        // Every editable column, not just the ones on show: the Edit button in
        // "Recently added" opens this row straight into the edit form, and a
        // partial row would save blanks over the columns it never fetched.
        .select(
          "id, created_at, street_number, street_name, unit_no, first_name, last_name, " +
            "cell_number, email, supporter, number_of_votes, lawn_sign, newsletter_consent, comments",
        )
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

  const refreshAll = useCallback(() => {
    refresh();
    setDataRefreshKey((key) => key + 1);
  }, [refresh]);

  useEffect(() => {
    function updateStatus() {
      setOnline(navigator.onLine);
    }
    function updateQueueCount() {
      setPendingCount(getPendingResidentCount());
    }

    window.addEventListener("online", updateStatus);
    window.addEventListener("offline", updateStatus);
    window.addEventListener("resident-queue-changed", updateQueueCount);
    return () => {
      window.removeEventListener("online", updateStatus);
      window.removeEventListener("offline", updateStatus);
      window.removeEventListener("resident-queue-changed", updateQueueCount);
    };
  }, []);

  useEffect(() => {
    if (!session || view !== "data") return;

    function refreshWhenVisible() {
      if (navigator.onLine && document.visibilityState === "visible") refreshAll();
    }

    refreshWhenVisible();
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("online", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("online", refreshWhenVisible);
    };
  }, [refreshAll, session, view]);

  useEffect(() => {
    if (!session || !online || pendingCount === 0) return;

    let cancelled = false;
    setSyncing(true);
    flushPendingResidents(supabase)
      .then((result) => {
        if (cancelled) return;
        setPendingCount(result.remaining);
        if (result.synced > 0) refreshAll();
      })
      .finally(() => {
        if (!cancelled) setSyncing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [online, pendingCount, refreshAll, session]);

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

  if (route === "#/data/print") {
    return <PrintableResidentsPage />;
  }

  return (
    <main className="page">
      <nav className="topbar">
        <div className="tabs">
          <button
            className={view === "add" ? "tab active" : "tab"}
            onClick={() => {
              window.location.hash = "#/add";
              setView("add");
            }}
          >
            Add
          </button>
          <button
            className={view === "data" ? "tab active" : "tab"}
            onClick={() => {
              window.location.hash = "#/data";
              setView("data");
            }}
          >
            Data
          </button>
        </div>
        <HeaderStats stats={stats} />
        <button className="signout" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </nav>

      <div className={online ? "offline-status online" : "offline-status offline"}>
        <span>{online ? "Online" : "Offline"}</span>
        {pendingCount > 0 && (
          <strong>
            {syncing ? "Syncing" : "Pending"}: {pendingCount}
          </strong>
        )}
      </div>

      {view === "add" ? (
        <ResidentForm
          streets={streets}
          recent={recent}
          onSaved={refreshAll}
          online={online}
        />
      ) : (
        <ResidentsList online={online} refreshKey={dataRefreshKey} />
      )}
    </main>
  );
}
