// monitor-collect-advisors
// Coleta advisors (segurança e performance) dos projetos ativos. Somente GET nos monitorados.
// Autenticação própria (verify_jwt=false): pg_cron (segredo do Vault) OU admin logado ("Coletar agora").
import { corsHeaders, json } from "../_shared/cors.ts";
import { isCronRequest, requireAdmin, serviceClient } from "../_shared/auth.ts";
import type { AdvisorCategory, NormalizedFinding } from "../_shared/core/advisors.ts";
import { type AdvisorsRepo, collectProjectAdvisors } from "../_shared/core/advisors-collector.ts";

const CHUNK = 200;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const viaCron = await isCronRequest(req);
  if (!viaCron && !(await requireAdmin(req))) return json({ error: "forbidden" }, 403);

  let onlyProject: string | undefined;
  try {
    const body = await req.json();
    onlyProject = typeof body?.project_id === "string" ? body.project_id : undefined;
  } catch {
    /* corpo vazio é válido */
  }

  const db = serviceClient();
  let q = db.from("projects").select("id, project_ref").eq("active", true);
  if (onlyProject) q = q.eq("id", onlyProject);
  const { data: projects, error } = await q;
  if (error) return json({ error: "falha ao listar projetos" }, 500);

  const repo: AdvisorsRepo = {
    async getExisting(projectId: string, category: AdvisorCategory) {
      const { data, error } = await db
        .from("advisor_findings")
        .select("fingerprint, status")
        .eq("project_id", projectId)
        .eq("category", category);
      if (error) throw new Error("getExisting");
      return data ?? [];
    },
    async upsertOpen(projectId: string, findings: NormalizedFinding[]) {
      const now = new Date().toISOString();
      // first_seen_at fica de fora: novos usam o default now(); existentes mantêm o valor.
      const rows = findings.map((f) => ({
        project_id: projectId,
        category: f.category,
        lint_name: f.lint_name,
        title: f.title,
        level: f.level,
        facing: f.facing,
        detail: f.detail,
        remediation_url: f.remediation_url,
        metadata: f.metadata,
        fingerprint: f.fingerprint,
        status: "open",
        last_seen_at: now,
        resolved_at: null,
      }));
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error } = await db.from("advisor_findings").upsert(rows.slice(i, i + CHUNK), { onConflict: "project_id,fingerprint" });
        if (error) throw new Error("upsertOpen");
      }
    },
    async resolve(projectId: string, fingerprints: string[]) {
      const now = new Date().toISOString();
      for (let i = 0; i < fingerprints.length; i += CHUNK) {
        const { error } = await db
          .from("advisor_findings")
          .update({ status: "resolved", resolved_at: now })
          .eq("project_id", projectId)
          .in("fingerprint", fingerprints.slice(i, i + CHUNK));
        if (error) throw new Error("resolve");
      }
    },
    async logRun(run) {
      await db.from("collection_runs").insert(run);
    },
  };

  const pat = Deno.env.get("MONITOR_SUPABASE_PAT") ?? null;
  const summary: Record<string, unknown> = {};
  // Sequencial por projeto: respeita o rate limit da Management API.
  for (const p of projects ?? []) {
    summary[p.id] = await collectProjectAdvisors(p, pat, repo);
  }

  console.log(JSON.stringify({ fn: "monitor-collect-advisors", via: viaCron ? "cron" : "admin", projects: (projects ?? []).length }));
  return json({ projects: (projects ?? []).length, results: summary });
});
