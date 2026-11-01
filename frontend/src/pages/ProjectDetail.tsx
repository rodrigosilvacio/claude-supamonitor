import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "../lib/supabase";
import { relativeTime } from "../lib/format";
import { ENV_LABEL, type Project } from "../lib/types";
import { availabilityPct, bucketLabel, daysToQuota, formatBytes, pctTone, RANGES, type RangeKey, type SeriesPoint } from "../lib/metrics";
import { isCritical, type Finding } from "../lib/security";
import { ChartCard, ChartTooltip, Kpi, StatusBadge, VIZ } from "../components/ui";

interface Latest {
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
}

const fmtPct = (v: number | null | undefined) => (v == null ? "–" : `${Number(v).toFixed(1)}%`);

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [latest, setLatest] = useState<Latest | null>(null);
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [findings, setFindings] = useState<Pick<Finding, "category" | "level">[]>([]);
  const [range, setRange] = useState<RangeKey>("24h");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    const r = RANGES[range];
    const [p, l, s, f] = await Promise.all([
      supabase.from("projects").select("*").eq("id", id).maybeSingle(),
      supabase.from("metric_snapshots").select("collected_at, scrape_ok, error, connections_used, connections_max, connections_used_pct, cpu_pct, mem_used_pct, db_size_bytes, disk_used_pct, replication_lag_s").eq("project_id", id).order("collected_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.rpc("metric_series", { p_project_id: id, p_hours: r.hours, p_bucket_minutes: r.bucket }),
      supabase.from("advisor_findings").select("category, level").eq("project_id", id).eq("status", "open"),
    ]);
    setProject((p.data as Project) ?? null);
    setLatest((l.data as Latest) ?? null);
    setSeries(((s.data as SeriesPoint[]) ?? []).map((x) => ({ ...x, db_size_bytes: x.db_size_bytes == null ? null : Number(x.db_size_bytes) })));
    setFindings((f.data as Pick<Finding, "category" | "level">[]) ?? []);
    setLoading(false);
  }, [id, range]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000); // acompanha o scrape de 1 min
    return () => clearInterval(t);
  }, [load]);

  const chartData = useMemo(
    () =>
      series.map((p) => ({
        ...p,
        label: bucketLabel(p.bucket, range),
        db_size_mb: p.db_size_bytes == null ? null : Math.round((p.db_size_bytes / 1024 / 1024) * 10) / 10,
      })),
    [series, range],
  );
  const availability = availabilityPct(series);
  const quotaDays = daysToQuota(series, project?.db_quota_bytes ?? null);
  const quotaPct = latest?.db_size_bytes && project?.db_quota_bytes ? (100 * latest.db_size_bytes) / project.db_quota_bytes : null;
  const hasLag = series.some((p) => p.replication_lag_s != null);
  const critical = findings.filter(isCritical).length;
  const stale = latest ? Date.now() - new Date(latest.collected_at).getTime() > 5 * 60_000 : true;

  if (!loading && !project) {
    return <div className="card text-sm text-slate-400">Projeto não encontrado. <Link to="/projetos" className="text-emerald-400">Voltar</Link></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link to="/projetos" className="text-xs text-slate-500 hover:text-slate-300">← Projetos</Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{project?.name ?? "…"}</h1>
          <p className="text-sm text-slate-400">
            <span className="font-mono">{project?.project_ref}</span> · {project ? ENV_LABEL[project.environment] : ""} · último scrape {relativeTime(latest?.collected_at ?? null)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {latest && (
            stale ? <StatusBadge tone="warning" label="Coleta atrasada" /> : latest.scrape_ok ? <StatusBadge tone="good" label="No ar" /> : <StatusBadge tone="critical" label="Falha na coleta" />
          )}
          <div className="flex rounded-lg border border-slate-700 p-0.5" role="group" aria-label="Período">
            {(Object.keys(RANGES) as RangeKey[]).map((k) => (
              <button key={k} onClick={() => setRange(k)} className={`rounded-md px-3 py-1 text-xs ${range === k ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"}`}>
                {k}
              </button>
            ))}
          </div>
        </div>
      </div>

      {latest && !latest.scrape_ok && latest.error && <div className="card border-rose-900 py-3 text-sm text-rose-300">Último scrape falhou: {latest.error}</div>}
      {!loading && !latest && (
        <div className="card text-sm text-slate-400">Ainda sem métricas. A coleta roda a cada minuto; confira se a Secret key está cadastrada em Projetos.</div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Conexões" value={fmtPct(latest?.connections_used_pct)} tone={pctTone(latest?.connections_used_pct)} hint={latest?.connections_used != null ? `${latest.connections_used} de ${latest.connections_max ?? "?"} permitidas` : "Sem dado"} />
        <Kpi label="CPU" value={fmtPct(latest?.cpu_pct)} tone={pctTone(latest?.cpu_pct)} hint={`Memória ${fmtPct(latest?.mem_used_pct)}`} />
        <Kpi
          label="Tamanho do banco"
          value={formatBytes(latest?.db_size_bytes)}
          tone={pctTone(quotaPct)}
          hint={project?.db_quota_bytes ? `${fmtPct(quotaPct)} da cota${quotaDays != null ? ` · cota em ~${quotaDays} d` : ""}` : "Informe a cota em Projetos"}
        />
        <Kpi label={`Disponibilidade (${range})`} value={availability == null ? "–" : `${availability}%`} tone={availability == null ? undefined : availability >= 99 ? "good" : availability >= 95 ? "warning" : "critical"} hint={`Disco ${fmtPct(latest?.disk_used_pct)}`} />
      </div>

      <div className="card flex flex-wrap items-center justify-between gap-3 py-4">
        <div className="text-sm text-slate-300">
          Segurança: <strong>{critical}</strong> críticos · {findings.filter((f) => f.category === "security").length} achados de segurança · {findings.filter((f) => f.category === "performance").length} de performance
        </div>
        <Link to="/seguranca" className="text-sm text-emerald-400 hover:underline">Ver achados →</Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <MetricChart title="Conexões em uso" unit="%" data={chartData} dataKey="connections_used_pct" threshold={80} domain={[0, 100]} />
        <MetricChart title="CPU" unit="%" data={chartData} dataKey="cpu_pct" threshold={80} domain={[0, 100]} />
        <MetricChart title="Memória" unit="%" data={chartData} dataKey="mem_used_pct" threshold={80} domain={[0, 100]} />
        <MetricChart title="Disco (/data)" unit="%" data={chartData} dataKey="disk_used_pct" threshold={80} domain={[0, 100]} />
        <MetricChart
          title="Tamanho do banco"
          unit=" MB"
          data={chartData}
          dataKey="db_size_mb"
          threshold={project?.db_quota_bytes ? Math.round((project.db_quota_bytes * 0.8) / 1024 / 1024) : undefined}
          thresholdLabel="80% da cota"
        />
        {hasLag && <MetricChart title="Lag de replicação" unit=" s" data={chartData} dataKey="replication_lag_s" threshold={30} thresholdLabel="30 s" />}
      </div>
    </div>
  );
}

function MetricChart({ title, unit, data, dataKey, threshold, thresholdLabel, domain }: {
  title: string;
  unit: string;
  data: Array<Record<string, unknown>>;
  dataKey: string;
  threshold?: number;
  thresholdLabel?: string;
  domain?: [number, number];
}) {
  const hasData = data.some((d) => d[dataKey] != null);
  return (
    <ChartCard title={title} subtitle={threshold != null ? `Linha tracejada: ${thresholdLabel ?? `${threshold}${unit}`}` : undefined}>
      {hasData ? (
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
              <CartesianGrid stroke={VIZ.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: VIZ.muted, fontSize: 11 }} tickLine={false} axisLine={{ stroke: VIZ.axis }} minTickGap={40} />
              <YAxis domain={domain ?? [0, (max: number) => Math.ceil(Math.max(max, threshold ?? 0) * 1.1)]} tick={{ fill: VIZ.muted, fontSize: 11 }} tickLine={false} axisLine={false} unit={unit.trim() === "%" ? "%" : ""} />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: VIZ.axis }} />
              {threshold != null && <ReferenceLine y={threshold} stroke={VIZ.muted} strokeDasharray="4 4" />}
              <Line type="monotone" dataKey={dataKey} name={`${title}${unit.trim() ? ` (${unit.trim()})` : ""}`} stroke={VIZ.series1} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="flex h-48 items-center justify-center text-sm text-slate-500">Sem dados no período.</div>
      )}
    </ChartCard>
  );
}
