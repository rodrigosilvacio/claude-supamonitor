// monitor-test-connection
// Chamado pelo botão "Testar conexão". Somente admin. Somente GET nos projetos monitorados.
// Nunca devolve segredos nem corpo bruto das respostas.
import { corsHeaders, json } from "../_shared/cors.ts";
import { requireAdmin, serviceClient } from "../_shared/auth.ts";
import { checkConnection } from "../_shared/core/connection-check.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  if (!(await requireAdmin(req))) return json({ error: "forbidden" }, 403);

  let projectId: string | undefined;
  try {
    ({ project_id: projectId } = await req.json());
  } catch {
    return json({ error: "corpo inválido" }, 400);
  }
  if (!projectId) return json({ error: "project_id obrigatório" }, 400);

  const db = serviceClient();
  const { data: project, error } = await db
    .from("projects")
    .select("id, project_ref")
    .eq("id", projectId)
    .maybeSingle();
  if (error || !project) return json({ error: "projeto não encontrado" }, 404);

  const { data: secretKey } = await db.rpc("get_project_secret", { p_project_id: projectId });
  const pat = Deno.env.get("MONITOR_SUPABASE_PAT") ?? null;

  try {
    const result = await checkConnection(project.project_ref, { secretKey: secretKey ?? null, pat });
    console.log(JSON.stringify({ fn: "monitor-test-connection", project_id: projectId, metrics_ok: result.metrics.ok, advisors_ok: result.advisors.ok }));
    return json(result);
  } catch (err) {
    console.error(JSON.stringify({ fn: "monitor-test-connection", project_id: projectId, error: err instanceof Error ? err.name : "unknown" }));
    return json({ error: "falha ao testar conexão" }, 500);
  }
});
