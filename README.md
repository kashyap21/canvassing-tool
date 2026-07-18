# Canvassing Tool — React + Supabase

A rebuild of the Django canvassing form as a **static React app (GitHub Pages)**
backed by a **Supabase** database. Four (or more) canvassers can enter residents
into one shared database at the same time.

- **Front-end:** React + Vite → hosted free on GitHub Pages
- **Back-end:** Supabase (hosted Postgres + auto API + auth) → free tier
- **Same features as the Django version:** the door form (with the N/A shortcut,
  validation, street type-ahead, live counters, recent list) plus a Data tab with
  search and CSV export.

> The original Django app is untouched in the parent folder. This is a separate,
> self-contained project.

---

## 1. Create the Supabase project (one time, ~5 min)

1. Go to <https://supabase.com> → sign in → **New project**. Pick a name, a strong
   database password, and the region closest to you. Wait for it to finish.
2. Open **SQL Editor → New query**, paste the entire contents of
   [`supabase/schema.sql`](supabase/schema.sql), and click **Run**. This creates
   the `residents` table, Row Level Security policies, and two helper functions.
3. Create your canvassers' logins: **Authentication → Users → Add user** (set
   email + password, tick "Auto Confirm User"). Add one per canvasser.
   - Prefer self sign-up? **Authentication → Providers → Email** and enable
     sign-ups. (This project ships with a sign-in screen only; add a sign-up form
     if you want in-app registration.)
4. Copy your keys from **Project Settings → API**:
   - **Project URL** → `VITE_SUPABASE_URL`
   - **anon public** key → `VITE_SUPABASE_ANON_KEY`
     (This key is safe to ship publicly — RLS is what protects the data. **Never**
     use the `service_role` key here.)

---

## 2. Run it locally

```bash
cd canvass-react
cp .env.example .env         # then paste your two values into .env
npm install
npm run dev                  # open the printed http://localhost:5173
```

Sign in with one of the logins you created. Add a resident, then check the **Data**
tab and **Export CSV**.

---

## 3. Deploy free to GitHub Pages

Pick **one** of the two options.

### Option A — one command (`gh-pages` package)

Push this project to a GitHub repo first, then:

```bash
npm run deploy               # builds and pushes ./dist to the gh-pages branch
```

In the repo: **Settings → Pages → Build and deployment → Source: Deploy from a
branch → Branch: `gh-pages` / root → Save.** Your site goes live at
`https://<you>.github.io/<repo>/`.

### Option B — GitHub Actions (auto-deploy on every push)

A ready workflow is included at [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

1. In the repo: **Settings → Pages → Source: GitHub Actions**.
2. Add your two keys as repo secrets: **Settings → Secrets and variables →
   Actions → New repository secret** → `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY`.
3. Push to `main`. The Action builds and publishes automatically.

> `vite.config.js` uses `base: "./"` (relative paths), so the build works at any
> Pages sub-path without extra config.

---

## Backups & the free-tier catch

- **Back up anytime:** open the **Data** tab and **Export CSV** — that is a full,
  portable snapshot of your database. (Or use the Supabase dashboard's Table
  Editor → export.)
- **Free Supabase projects pause after ~7 days of no activity.** Your data is kept;
  you just click **Resume** in the dashboard before the next use. Automatic daily
  backups are a paid feature — the CSV export covers you on the free tier.

## Capacity

7,000 residents is a few MB — about 1% of the free 500 MB database. Four (or many
more) people entering at once is no problem: Postgres handles concurrent inserts
natively.

## Where things live

- `supabase/schema.sql` — database table, RLS policies, helper functions
- `src/App.jsx` — auth session, tab switching, loads streets/stats/recent
- `src/components/Login.jsx` — email/password sign-in
- `src/components/ResidentForm.jsx` — the door form (fields, N/A, validation, type-ahead)
- `src/components/ResidentsList.jsx` — Data tab: search + paginated CSV export
- `src/lib/csv.js` — CSV builder/download
- `src/supabaseClient.js` — Supabase connection
- `src/styles.css` — styling (ported from the Django app)
