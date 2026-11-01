/** Utilidades puras de métricas para o frontend (testadas em tests/frontend-metrics.test.ts). */

export interface SeriesPoint {
  bucket: string;
  connections_used_pct: number | null;
  cpu_pct: number | null;
  mem_used_pct: number | null;
  db_size_bytes: number | null;
  disk_used_pct: number | null;
  replication_lag_s: number | null;
  scrapes: number;
  scrapes_ok: number;
}

export const RANGES = {
  "1h": { hours: 1, bucket: 1, label: "1 hora" },
  "24h": { hours: 24, bucket: 5, label: "24 horas" },
  "7d": { hours: 168, bucket: 60, label: "7 dias" },
  "30d": { hours: 720, bucket: 360, label: "30 dias" },
} as const;
export type RangeKey = keyof typeof RANGES;

export function availabilityPct(points: Pick<SeriesPoint, "scrapes" | "scrapes_ok">[]): number | null {
  const total = points.reduce((a, p) => a + p.scrapes, 0);
  if (!total) return null;
  const ok = points.reduce((a, p) => a + p.scrapes_ok, 0);
  return Math.round((ok / total) * 1000) / 10;
}

/** Tom do farol para uma métrica percentual: >= 80% atenção, >= 95% crítico. */
export function pctTone(v: number | null | undefined): "critical" | "warning" | "good" | undefined {
  if (v == null) return undefined;
  if (v >= 95) return "critical";
  if (v >= 80) return "warning";
  return "good";
}

/** Projeção linear simples de dias até atingir a cota (null sem tendência de crescimento). */
export function daysToQuota(points: Pick<SeriesPoint, "bucket" | "db_size_bytes">[], quotaBytes: number | null): number | null {
  if (!quotaBytes) return null;
  const pts = points.filter((p) => p.db_size_bytes != null) as Array<{ bucket: string; db_size_bytes: number }>;
  if (pts.length < 2) return null;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const days = (new Date(last.bucket).getTime() - new Date(first.bucket).getTime()) / 86_400_000;
  const growthPerDay = (last.db_size_bytes - first.db_size_bytes) / (days || 1);
  if (days <= 0 || growthPerDay <= 0) return null;
  if (last.db_size_bytes >= quotaBytes) return 0;
  return Math.round((quotaBytes - last.db_size_bytes) / growthPerDay);
}

export function formatBytes(b: number | null | undefined): string {
  if (b == null) return "–";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = b;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function bucketLabel(iso: string, range: RangeKey): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (range === "1h" || range === "24h") return `${hh}:${mm}`;
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}${range === "7d" ? ` ${hh}h` : ""}`;
}
