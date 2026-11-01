// Edge Functions são chamadas pelo frontend no GitHub Pages (outra origem).
// ALLOWED_ORIGIN pode restringir a origem (ex.: https://rodrigosilvacio.github.io).
const allowedOrigin = Deno.env.get("MONITOR_ALLOWED_ORIGIN") ?? "*";

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
