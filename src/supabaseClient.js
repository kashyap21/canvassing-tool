import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// A clear, early failure beats a confusing "fetch failed" later on.
export const isConfigured = Boolean(url && anonKey);

if (!isConfigured) {
  // eslint-disable-next-line no-console
  console.error(
    "Supabase is not configured. Copy .env.example to .env and set " +
      "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then restart the dev server."
  );
}

export const supabase = isConfigured
  ? createClient(url, anonKey)
  : null;
