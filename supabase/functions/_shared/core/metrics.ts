/**
 * Extração dos indicadores do monitor a partir das séries da Metrics API.
 * Nomes de métricas: dashboard oficial supabase-grafana + validação na saída real
 * (catálogo em monitor.metric_catalog). Série ausente vira null (nunca exceção).
 * Módulo puro.
 */
import { type ParsedMetrics, parsePrometheus, type Sample } from "./prometheus.ts";

/** Métricas que o monitor usa. O teste de contrato falha se alguma sumir do endpoint. */
export const REQUIRED_METRICS = [
  "pg_stat_database_num_backends",
  "node_cpu_seconds_total",
  "node_filesystem_size_bytes",
  "node_filesystem_avail_bytes",
  "node_memory_MemTotal_bytes",
  "node_memory_MemAvailable_bytes",
] as const;

/** Usadas se existirem (há alternativas ou dependem do plano/configuração). */
export const OPTIONAL_METRICS = [
  "pg_up",
  "max_connections_connection_count", // exporter Supabase (validado na saída real em 01/11/2026)
  "pg_settings_max_connections",
  "pg_database_size_bytes",
  "pg_database_size_mb",
  "physical_replication_lag_physical_replication_lag_seconds",
  "pgbouncer_pools_client_active_connections", // pooler do projeto validado (pgbouncer)
  "supavisor_connections_active", // fallback, se o projeto usar Supavisor exposto no endpoint
] as const;

export interface CpuCounters {
  idle: number;
  total: number;
}

export interface MetricSnapshot {
  pg_up: boolean | null;
  connections_used: number | null;
  connections_max: number | null;
  connections_used_pct: number | null;
  cpu_pct: number | null;
  mem_used_pct: number | null;
  db_size_bytes: number | null;
  disk_used_pct: number | null;
  replication_lag_s: number | null;
  pooler_connections: number | null;
  cpu_counters: CpuCounters | null;
  missing_required: string[];
}

const finite = (v: number) => Number.isFinite(v);
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

function byName(samples: Sample[], name: string): Sample[] {
  return samples.filter((s) => s.name === name && finite(s.value));
}

function sum(samples: Sample[]): number | null {
  return samples.length ? samples.reduce((a, s) => a + s.value, 0) : null;
}

function max(samples: Sample[]): number | null {
  return samples.length ? Math.max(...samples.map((s) => s.value)) : null;
}

/** Disco do banco: mountpoint /data (Supabase); fallback "/". Usa a maior série do mountpoint. */
function diskUsedPct(samples: Sample[]): number | null {
  for (const mp of ["/data", "/"]) {
    const size = max(byName(samples, "node_filesystem_size_bytes").filter((s) => s.labels.mountpoint === mp));
    const avail = max(byName(samples, "node_filesystem_avail_bytes").filter((s) => s.labels.mountpoint === mp));
    if (size && size > 0 && avail != null) return round(100 * (1 - avail / size));
  }
  return null;
}

export function cpuCounters(samples: Sample[]): CpuCounters | null {
  const cpu = byName(samples, "node_cpu_seconds_total");
  if (!cpu.length) return null;
  return { idle: cpu.filter((s) => s.labels.mode === "idle").reduce((a, s) => a + s.value, 0), total: cpu.reduce((a, s) => a + s.value, 0) };
}

/** CPU % entre dois scrapes (contadores acumulados). null no primeiro scrape ou após reset do contador. */
export function cpuPctBetween(prev: CpuCounters | null, cur: CpuCounters | null): number | null {
  if (!prev || !cur) return null;
  const dTotal = cur.total - prev.total;
  const dIdle = cur.idle - prev.idle;
  if (dTotal <= 0 || dIdle < 0 || dIdle > dTotal) return null;
  return round(100 * (1 - dIdle / dTotal));
}

export function extractSnapshot(
  parsed: ParsedMetrics,
  opts: { prevCpu?: CpuCounters | null; prevCpuPct?: number | null; maxConnectionsFallback?: number | null } = {},
): MetricSnapshot {
  const s = parsed.samples;
  const present = new Set(s.map((x) => x.name));
  const missing_required = REQUIRED_METRICS.filter((m) => !present.has(m));

  const pgUp = max(byName(s, "pg_up"));
  const used = sum(byName(s, "pg_stat_database_num_backends"));
  // Denominador: exporter Supabase > pg_settings (não exposto hoje) > cadastro do projeto.
  const maxFromMetric = max(byName(s, "max_connections_connection_count")) ?? max(byName(s, "pg_settings_max_connections"));
  const connMax = maxFromMetric && maxFromMetric > 0 ? maxFromMetric : opts.maxConnectionsFallback ?? null;

  const sizeBytes = sum(byName(s, "pg_database_size_bytes"));
  const sizeMb = sum(byName(s, "pg_database_size_mb"));
  const db_size_bytes = sizeBytes ?? (sizeMb != null ? Math.round(sizeMb * 1024 * 1024) : null);

  const memTotal = max(byName(s, "node_memory_MemTotal_bytes"));
  const memAvail = max(byName(s, "node_memory_MemAvailable_bytes"));

  const counters = cpuCounters(s);

  return {
    pg_up: pgUp == null ? null : pgUp >= 1,
    connections_used: used,
    connections_max: connMax,
    connections_used_pct: used != null && connMax ? round((100 * used) / connMax) : null,
    // A Metrics API atualiza a cada ~1 min e pode repetir os mesmos contadores: nesse caso, repete o último valor.
    cpu_pct: opts.prevCpu && counters && counters.total === opts.prevCpu.total ? opts.prevCpuPct ?? null : cpuPctBetween(opts.prevCpu ?? null, counters),
    mem_used_pct: memTotal && memAvail != null ? round(100 * (1 - memAvail / memTotal)) : null,
    db_size_bytes,
    disk_used_pct: diskUsedPct(s),
    replication_lag_s: max(byName(s, "physical_replication_lag_physical_replication_lag_seconds")),
    pooler_connections: sum(byName(s, "pgbouncer_pools_client_active_connections")) ?? sum(byName(s, "supavisor_connections_active")),
    cpu_counters: counters,
    missing_required: [...missing_required],
  };
}

/** Catálogo (nome, tipo, chaves de label, 1 exemplo de labels) para inspecionar a saída real sem guardar valores. */
export function buildCatalog(parsed: ParsedMetrics): Array<{ metric_name: string; type: string | null; label_keys: string[]; sample_labels: Record<string, string>; series: number }> {
  const out = new Map<string, { metric_name: string; type: string | null; label_keys: Set<string>; sample_labels: Record<string, string>; series: number }>();
  for (const smp of parsed.samples) {
    const cur = out.get(smp.name) ?? { metric_name: smp.name, type: parsed.families.get(smp.name)?.type ?? null, label_keys: new Set<string>(), sample_labels: smp.labels, series: 0 };
    Object.keys(smp.labels).forEach((k) => cur.label_keys.add(k));
    cur.series++;
    out.set(smp.name, cur);
  }
  return [...out.values()].map((c) => ({ ...c, label_keys: [...c.label_keys].sort() }));
}

export { parsePrometheus };
