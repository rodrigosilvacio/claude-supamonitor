/**
 * Scrape de métricas de UM projeto (lógica pura, dependências injetadas).
 * Regras: somente GET; falha nunca lança (vira snapshot scrape_ok=false + contador de falhas);
 * pg_up=0 conta como falha (banco fora do ar mesmo com endpoint respondendo).
 */
import { describeStatus } from "./connection-check.ts";
import { buildCatalog, type CpuCounters, extractSnapshot, type MetricSnapshot, parsePrometheus } from "./metrics.ts";
import { type FetchLike, metricsAuthHeader, metricsUrl, readOnlyGet } from "./readonly.ts";

export interface SnapshotRow {
  project_id: string;
  collected_at: string;
  scrape_ok: boolean;
  error: string | null;
  connections_used: number | null;
  connections_max: number | null;
  connections_used_pct: number | null;
  cpu_pct: number | null;
  mem_used_pct: number | null;
  db_size_bytes: number | null;
  disk_used_pct: number | null;
  replication_lag_s: number | null;
  pooler_connections: number | null;
  raw_subset: { cpu: CpuCounters | null; missing_required: string[]; scrape_ms: number };
}

export interface MetricsRepo {
  previousCpu(projectId: string): Promise<CpuCounters | null>;
  insertSnapshot(row: SnapshotRow): Promise<void>;
  /** ok=true zera consecutive_failures; ok=false incrementa. Atualiza last_scrape_at. Devolve o novo contador. */
  markScrape(projectId: string, ok: boolean, at: string): Promise<number>;
  catalogIsStale(projectId: string): Promise<boolean>;
  upsertCatalog(projectId: string, rows: ReturnType<typeof buildCatalog>): Promise<void>;
  logFailure(projectId: string, message: string, httpStatus: number | null): Promise<void>;
}

export interface ScrapeResult {
  ok: boolean;
  message: string;
  consecutiveFailures: number;
  snapshot?: MetricSnapshot;
}

const EMPTY = {
  connections_used: null,
  connections_max: null,
  connections_used_pct: null,
  cpu_pct: null,
  mem_used_pct: null,
  db_size_bytes: null,
  disk_used_pct: null,
  replication_lag_s: null,
  pooler_connections: null,
};

export async function scrapeProject(
  project: { id: string; project_ref: string; max_connections: number | null },
  secretKey: string | null,
  repo: MetricsRepo,
  opts: { fetchImpl?: FetchLike; now?: () => Date } = {},
): Promise<ScrapeResult> {
  const at = (opts.now ?? (() => new Date()))().toISOString();

  const fail = async (message: string, http: number | null, ms = 0): Promise<ScrapeResult> => {
    let failures = 0;
    try {
      await repo.insertSnapshot({ project_id: project.id, collected_at: at, scrape_ok: false, error: message, ...EMPTY, raw_subset: { cpu: null, missing_required: [], scrape_ms: ms } });
      failures = await repo.markScrape(project.id, false, at);
      await repo.logFailure(project.id, message, http);
    } catch {
      /* nunca propaga */
    }
    return { ok: false, message, consecutiveFailures: failures };
  };

  if (!secretKey) return fail("Secret key não cadastrada", null);

  try {
    const res = await readOnlyGet(metricsUrl(project.project_ref), metricsAuthHeader(secretKey), { fetchImpl: opts.fetchImpl, timeoutMs: 15_000 });
    if (!res.ok) return fail(describeStatus(res.status, res.error), res.status || null, res.durationMs);

    const parsed = parsePrometheus(res.body);
    if (parsed.samples.length === 0) return fail("resposta sem métricas (formato pode ter mudado)", res.status, res.durationMs);

    const prevCpu = await repo.previousCpu(project.id);
    const snap = extractSnapshot(parsed, { prevCpu, maxConnectionsFallback: project.max_connections });
    const dbDown = snap.pg_up === false;
    const message = dbDown ? "banco fora do ar (pg_up = 0)" : snap.missing_required.length ? `métricas ausentes: ${snap.missing_required.join(", ")}` : "ok";

    await repo.insertSnapshot({
      project_id: project.id,
      collected_at: at,
      scrape_ok: !dbDown,
      error: message === "ok" ? null : message,
      connections_used: snap.connections_used,
      connections_max: snap.connections_max,
      connections_used_pct: snap.connections_used_pct,
      cpu_pct: snap.cpu_pct,
      mem_used_pct: snap.mem_used_pct,
      db_size_bytes: snap.db_size_bytes,
      disk_used_pct: snap.disk_used_pct,
      replication_lag_s: snap.replication_lag_s,
      pooler_connections: snap.pooler_connections,
      raw_subset: { cpu: snap.cpu_counters, missing_required: snap.missing_required, scrape_ms: res.durationMs },
    });
    const failures = await repo.markScrape(project.id, !dbDown, at);
    if (dbDown) await repo.logFailure(project.id, message, res.status);

    if (await repo.catalogIsStale(project.id)) await repo.upsertCatalog(project.id, buildCatalog(parsed));

    return { ok: !dbDown, message, consecutiveFailures: failures, snapshot: snap };
  } catch {
    return fail("erro interno ao processar o scrape", null);
  }
}
