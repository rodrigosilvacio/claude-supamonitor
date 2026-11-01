// monitor-collect-metrics
// Scrape da Metrics API (a cada 1 min via pg_cron) dos projetos ativos. Somente GET nos monitorados.
// Autenticação própria (verify_jwt=false): pg_cron (segredo do Vault) OU admin logado.
import { corsHeaders, json } from "../_shared/cors.ts";
import { isCronRequest, requireAdmin, serviceClient } from "../_shared/auth.ts";
import type { CpuCounters } from "../_shared/core/metrics.ts";
import { type MetricsRepo, scrapeProject } from "../_shared/core/metrics-collector.ts";

const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const viaCron = await isCronRequest(req);
  if (!viaCron && !(await requireAdmin(req))) return json({ error: "forbidden" }, 403);

  const db = serviceClient();
  const { data: projects, error } = await db.from("projects").select("id, project_ref, max_connections").eq("active", true);
  if (error) return json({ error: "falha ao listar projetos" }, 500);

  const repo: MetricsRepo = {
    async previousCpu(projectId) {
      const { data } = await db
        .from("metric_snapshots")
        .select("raw_subset")
        .eq("project_id", projectId)
        .eq("scrape_ok", true)
        .order("collected_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data?.raw_subset?.cpu as CpuCounters | undefined) ?? null;
    },
    async insertSnapshot(row) {
      const { error } = await db.from("metric_snapshots").insert(row);
      if (error) throw new Error("insertSnapshot");
    },
    async markScrape(projectId, ok, at) {
      const { data, error } = await db.rpc("mark_scrape", { p_project_id: projectId, p_ok: ok, p_at: at });
      if (error) throw new Error("markScrape");
      return Number(data ?? 0);
    },
    async catalogIsStale(projectId) {
      const { data } = await db
        .from("metric_catalog")
        .select("last_seen_at")
        .eq("project_id", projectId)
        .order("last_seen_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return !data || Date.now() - new Date(data.last_seen_at).getTime() > CATALOG_TTL_MS;
    },
    async upsertCatalog(projectId, rows) {
      const now = new Date().toISOString();
      await db.from("metric_catalog").upsert(rows.map((r) => ({ project_id: projectId, ...r, last_seen_at: now })), { onConflict: "project_id,metric_name" });
    },
    async logFailure(projectId, message, httpStatus) {
      await db.from("collection_runs").insert({ project_id: projectId, kind: "metrics", ok: false, http_status: httpStatus, message, finished_at: new Date().toISOString() });
    },
  };

  // Projetos em paralelo; falha de um não afeta os outros.
  const results = await Promise.allSettled(
    (projects ?? []).map(async (p) => {
      const { data: secret } = await db.rpc("get_project_secret", { p_project_id: p.id });
      const r = await scrapeProject(p, secret ?? null, repo);
      return { project_id: p.id, ok: r.ok, message: r.message, consecutive_failures: r.consecutiveFailures };
    }),
  );

  const summary = results.map((r) => (r.status === "fulfilled" ? r.value : { ok: false, message: "erro inesperado" }));
  console.log(JSON.stringify({ fn: "monitor-collect-metrics", via: viaCron ? "cron" : "admin", projects: summary.length, ok: summary.filter((s) => s.ok).length }));
  return json({ projects: summary.length, results: summary });
});
