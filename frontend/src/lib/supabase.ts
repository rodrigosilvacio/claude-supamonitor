import { createClient } from "@supabase/supabase-js";

// Remove barra final (ex.: "https://x.supabase.co/") para evitar "//rest/v1".
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim().replace(/\/+$/, "");
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim();

export const configMissing = !url || !key;

// URL e publishable key são públicas por desenho: os dados ficam protegidos por Auth + RLS.
export const supabase = createClient(url ?? "http://localhost", key ?? "missing", {
  db: { schema: "monitor" },
  auth: { persistSession: true, autoRefreshToken: true },
});
