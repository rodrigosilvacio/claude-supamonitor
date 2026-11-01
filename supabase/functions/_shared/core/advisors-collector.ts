/**
 * Orquestração da coleta de advisors de UM projeto (lógica pura, dependências injetadas).
 * Regras:
 *  - somente GET (readOnlyGet + allowlist);
 *  - falha de coleta NUNCA resolve achados (só reconcilia após resposta 2xx e parse válido);
 *  - falha em uma categoria não impede a outra;
 *  - nada lança: tudo vira registro em collection_runs.
 */
import { type AdvisorCategory, type ExistingFinding, type NormalizedFinding, normalizeAdvisors, planReconcile } from "./advisors.ts";
import { describeStatus } from "./connection-check.ts";
import { advisorsUrl, type FetchLike, managementAuthHeader, readOnlyGet } from "./readonly.ts";

export interface AdvisorsRepo {
  getExisting(projectId: string, category: AdvisorCategory): Promise<ExistingFinding[]>;
  /** Upsert por (project_id, fingerprint) SEM sobrescrever first_seen_at; marca open e last_seen_at=agora. */
  upsertOpen(projectId: string, findings: NormalizedFinding[]): Promise<void>;
  resolve(projectId: string, fingerprints: string[]): Promise<void>;
  logRun(run: CollectionRun): Promise<void>;
}

export interface CollectionRun {
  project_id: string;
  kind: "advisors_security" | "advisors_performance";
  ok: boolean;
  http_status: number | null;
  message: string;
  items: number | null;
  details: Record<string, unknown>;
  started_at: string;
  finished_at: string;
}

export interface CategoryResult {
  category: AdvisorCategory;
  ok: boolean;
  message: string;
  total?: number;
  inserted?: number;
  resolved?: number;
  reopened?: number;
}

const CATEGORIES: AdvisorCategory[] = ["security", "performance"];

export async function collectProjectAdvisors(
  project: { id: string; project_ref: string },
  pat: string | null,
  repo: AdvisorsRepo,
  opts: { fetchImpl?: FetchLike; now?: () => Date } = {},
): Promise<CategoryResult[]> {
  const now = opts.now ?? (() => new Date());
  const results: CategoryResult[] = [];

  for (const category of CATEGORIES) {
    const started = now().toISOString();
    const kind = `advisors_${category}` as const;
    const fail = async (message: string, http: number | null): Promise<void> => {
      results.push({ category, ok: false, message });
      await repo.logRun({ project_id: project.id, kind, ok: false, http_status: http, message, items: null, details: {}, started_at: started, finished_at: now().toISOString() }).catch(() => {});
    };

    if (!pat) {
      await fail("MONITOR_SUPABASE_PAT não configurado", null);
      continue;
    }

    try {
      const res = await readOnlyGet(advisorsUrl(project.project_ref, category), managementAuthHeader(pat), { fetchImpl: opts.fetchImpl, timeoutMs: 30_000 });
      if (!res.ok) {
        await fail(describeStatus(res.status, res.error), res.status || null);
        continue;
      }

      let findings: NormalizedFinding[];
      try {
        findings = normalizeAdvisors(JSON.parse(res.body), category);
      } catch {
        await fail("formato de resposta inesperado (API experimental pode ter mudado)", res.status);
        continue;
      }

      const existing = await repo.getExisting(project.id, category);
      const plan = planReconcile(existing, findings);
      if (findings.length) await repo.upsertOpen(project.id, findings);
      if (plan.resolve.length) await repo.resolve(project.id, plan.resolve);

      const summary = { total: findings.length, inserted: plan.inserts.length, resolved: plan.resolve.length, reopened: plan.reopened };
      results.push({ category, ok: true, message: "ok", ...summary });
      await repo.logRun({ project_id: project.id, kind, ok: true, http_status: res.status, message: "ok", items: findings.length, details: summary, started_at: started, finished_at: now().toISOString() });
    } catch {
      await fail("erro interno ao processar a coleta", null);
    }
  }
  return results;
}
