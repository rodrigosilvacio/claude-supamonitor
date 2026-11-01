import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** Cliente service_role restrito ao schema `monitor` (uso interno das funções). */
export function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    db: { schema: "monitor" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Verifica se o JWT da requisição pertence a um admin do monitor (monitor.is_admin()). */
export async function requireAdmin(req: Request): Promise<boolean> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return false;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    db: { schema: "monitor" },
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await userClient.rpc("is_admin");
  return !error && data === true;
}
