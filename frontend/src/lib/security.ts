/** Cálculos puros da página Segurança (testados em tests/security-metrics.test.ts). */

export type Level = "ERROR" | "WARN" | "INFO";
export type Category = "security" | "performance";

export interface Finding {
  id: string;
  project_id: string;
  category: Category;
  lint_name: string;
  title: string;
  level: Level;
  detail: string;
  remediation_url: string | null;
  status: "open" | "resolved";
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
}

export type Light = "critical" | "warning" | "ok";

const DAY = 86_400_000;

export const isCritical = (f: Pick<Finding, "category" | "level">) => f.category === "security" && f.level === "ERROR";

export function ageDays(iso: string, now = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / DAY));
}

/** Farol de segurança do projeto: vermelho com crítico aberto; amarelo com qualquer outro aberto relevante. */
export function securityLight(open: Finding[]): Light {
  if (open.some(isCritical)) return "critical";
  if (open.some((f) => f.level === "WARN" || f.level === "ERROR")) return "warning";
  return "ok";
}

export interface SecurityKpis {
  criticalOpen: number;
  open: number;
  resolved30d: number;
  avgCriticalAgeDays: number | null;
}

export function computeKpis(all: Finding[], now = Date.now()): SecurityKpis {
  const open = all.filter((f) => f.status === "open");
  const critical = open.filter(isCritical);
  const resolved30d = all.filter((f) => f.resolved_at && now - new Date(f.resolved_at).getTime() <= 30 * DAY).length;
  const avg = critical.length ? Math.round(critical.reduce((s, f) => s + ageDays(f.first_seen_at, now), 0) / critical.length) : null;
  return { criticalOpen: critical.length, open: open.length, resolved30d, avgCriticalAgeDays: avg };
}

export interface TrendPoint {
  day: string; // YYYY-MM-DD
  label: string; // dd/mm
  open: number;
  critical: number;
}

/** Abertos e críticos ao fim de cada dia, nos últimos `days` dias (reconstruído de first_seen/resolved). */
export function openTrend(all: Finding[], days = 30, now = Date.now()): TrendPoint[] {
  const out: TrendPoint[] = [];
  const today = new Date(now);
  today.setHours(23, 59, 59, 999);
  for (let i = days - 1; i >= 0; i--) {
    const end = today.getTime() - i * DAY;
    const d = new Date(end);
    const alive = all.filter((f) => new Date(f.first_seen_at).getTime() <= end && (!f.resolved_at || new Date(f.resolved_at).getTime() > end));
    out.push({
      day: d.toISOString().slice(0, 10),
      label: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`,
      open: alive.length,
      critical: alive.filter(isCritical).length,
    });
  }
  return out;
}

/** Top N tipos de achado abertos (por título do lint). */
export function topLints(open: Finding[], n = 8): Array<{ name: string; count: number; critical: boolean }> {
  const m = new Map<string, { count: number; critical: boolean }>();
  for (const f of open) {
    const cur = m.get(f.title) ?? { count: 0, critical: false };
    m.set(f.title, { count: cur.count + 1, critical: cur.critical || isCritical(f) });
  }
  return [...m.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, n);
}

export const LEVEL_ORDER: Record<Level, number> = { ERROR: 0, WARN: 1, INFO: 2 };
