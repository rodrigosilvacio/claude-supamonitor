import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "../lib/supabase";
import { relativeTime } from "../lib/format";
import type { Project } from "../lib/types";
import {
  ageDays,
  computeKpis,
  type Finding,
  isCritical,
  LEVEL_ORDER,
  openTrend,
  securityLight,
  topLints,
} from "../lib/security";
import { ChartCard, ChartTooltip, Kpi, LegendItem, StatusBadge, VIZ } from "../components/ui";

interface Run {
  project_id: string;
  kind: string;
  ok: boolean;
  message: string | null;
  started_at: string;
}

const LEVEL_TONE = { ERROR: "critical", WARN: "warning", INFO: "info" } as const;
const LEVEL_LABEL = { ERROR: "Crítico", WARN: "Atenção", INFO: "Info" } as const;
const LIGHT = {
  critical: { tone: "critical", label: "Crítico" },
  warning: { tone: "warning", label: "Atenção" },
  ok: { tone: "good", label: "OK" },
} as const;

export default function Security() {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [collecting, setCollecting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [filters, setFilters] = useState({ project: "all", category: "security", level: "all", status: "open" });

  const load = useCallback(async () => {
    const [f, p, r] = await Promise.all([
      supabase.from("advisor_findings").select("id, project_id, category, lint_name, title, level, detail, remediation_url, status, first_seen_at, last_seen_at, resolved_at").limit(5000),
      supabase.from("projects").select("*").order("name"),
      supabase.from("collection_runs").select("project_id, kind, ok, message, started_at").like("kind", "advisors_%").order("started_at", { ascending: false }).limit(50),
    ]);
    setFindings((f.data as Finding[]) ?? []);
    setProjects((p.data as Project[]) ?? []);
    setRuns((r.data as Run[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function collectNow() {
    setCollecting(true);
    setMessage(null);
    const { error } = await supabase.functions.invoke("monitor-collect-advisors", { body: {} });
    setMessage(error ? "Falha ao coletar. Veja o histórico de coletas abaixo." : "Coleta concluída.");
    setCollecting(false);
    load();
  }

  const projectName = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p.name])), [projects]);

  // Escopo dos indicadores: projeto + categoria. Nível/status filtram só a tabela.
  const scoped = useMemo(
    () =>
      findings.filter(
        (f) => (filters.project === "all" || f.project_id === filters.project) && (filters.category === "all" || f.category === filters.category),
      ),
    [findings, filters.project, filters.category],
  );
  const kpis = useMemo(() => computeKpis(scoped), [scoped]);
  const trend = useMemo(() => openTrend(scoped, 30), [scoped]);
  const openScoped = useMemo(() => scoped.filter((f) => f.status === "open"), [scoped]);
  const top = useMemo(() => topLints(openScoped, 8), [openScoped]);

  const table = useMemo(
    () =>
      scoped
        .filter((f) => (filters.level === "all" || f.level === filters.level) && (filters.status === "all" || f.status === filters.status))
        .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || a.first_seen_at.localeCompare(b.first_seen_at)),
    [scoped, filters.level, filters.status],
  );

  // Agrupa por projeto + tipo + nível: 53 achados iguais viram 1 linha expansível.
  const groups = useMemo(() => {
    const m = new Map<string, { key: string; project_id: string; title: string; level: Finding["level"]; items: Finding[] }>();
    for (const f of table) {
      const key = `${f.project_id}|${f.title}|${f.level}`;
      const g = m.get(key) ?? { key, project_id: f.project_id, title: f.title, level: f.level, items: [] };
      g.items.push(f);
      m.set(key, g);
    }
    return [...m.values()];
  }, [table]);

  const lastRun = runs[0];
  const lastFailure = runs.find((r) => !r.ok);

  const set = (k: keyof typeof filters) => (e: React.ChangeEvent<HTMLSelectElement>) => setFilters((s) => ({ ...s, [k]: e.target.value }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Segurança</h1>
          <p className="text-sm text-slate-400">
            Achados dos Advisors do Supabase. Última coleta: {lastRun ? relativeTime(lastRun.started_at) : "nunca"} · automática a cada 6 h
          </p>
        </div>
        <button className="btn-primary" onClick={collectNow} disabled={collecting}>
          {collecting ? "Coletando…" : "Coletar agora"}
        </button>
      </div>

      {message && <div className="card py-3 text-sm text-slate-300">{message}</div>}
      {lastFailure && lastRun && !lastRun.ok && (
        <div className="card border-rose-900 py-3 text-sm text-rose-300">
          Última coleta falhou ({projectName[lastFailure.project_id] ?? "projeto"}): {lastFailure.message}
        </div>
      )}

      {/* Filtros: uma linha, acima dos gráficos */}
      <div className="flex flex-wrap gap-3">
        <Select label="Projeto" value={filters.project} onChange={set("project")}>
          <option value="all">Todos os projetos</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Select label="Categoria" value={filters.category} onChange={set("category")}>
          <option value="security">Segurança</option>
          <option value="performance">Performance</option>
          <option value="all">Todas</option>
        </Select>
        <Select label="Nível (tabela)" value={filters.level} onChange={set("level")}>
          <option value="all">Todos</option>
          <option value="ERROR">Crítico</option>
          <option value="WARN">Atenção</option>
          <option value="INFO">Info</option>
        </Select>
        <Select label="Status (tabela)" value={filters.status} onChange={set("status")}>
          <option value="open">Abertos</option>
          <option value="resolved">Resolvidos</option>
          <option value="all">Todos</option>
        </Select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Críticos abertos" value={kpis.criticalOpen} tone={kpis.criticalOpen ? "critical" : "good"} hint="Nível ERROR em segurança" />
        <Kpi label="Achados abertos" value={kpis.open} hint="No escopo filtrado" />
        <Kpi label="Resolvidos (30 dias)" value={kpis.resolved30d} tone={kpis.resolved30d ? "good" : undefined} />
        <Kpi label="Idade média dos críticos" value={kpis.avgCriticalAgeDays == null ? "–" : `${kpis.avgCriticalAgeDays} d`} hint="Desde a primeira detecção" />
      </div>

      {/* Farol por projeto */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects.filter((p) => filters.project === "all" || p.id === filters.project).map((p) => {
          const open = findings.filter((f) => f.project_id === p.id && f.status === "open");
          const light = LIGHT[securityLight(open)];
          return (
            <div key={p.id} className="card flex items-center justify-between gap-3 py-4">
              <div>
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-slate-500">
                  {open.filter(isCritical).length} críticos · {open.filter((f) => f.category === "security").length} segurança · {open.filter((f) => f.category === "performance").length} performance
                </div>
              </div>
              <StatusBadge tone={light.tone} label={light.label} />
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Tendência de achados abertos"
          subtitle="Últimos 30 dias, ao fim de cada dia"
          legend={<div className="flex gap-3"><LegendItem color={VIZ.series1} label="Abertos" /><LegendItem color={VIZ.series2} label="Críticos" /></div>}
        >
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                <CartesianGrid stroke={VIZ.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fill: VIZ.muted, fontSize: 11 }} tickLine={false} axisLine={{ stroke: VIZ.axis }} interval={6} />
                <YAxis allowDecimals={false} tick={{ fill: VIZ.muted, fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: VIZ.axis }} />
                <Line type="monotone" dataKey="open" name="Abertos" stroke={VIZ.series1} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="critical" name="Críticos" stroke={VIZ.series2} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="Principais tipos de achado" subtitle="Abertos no escopo filtrado">
          {top.length === 0 ? (
            <Empty loading={loading} />
          ) : (
            <div style={{ height: Math.max(160, top.length * 30) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={top} layout="vertical" margin={{ top: 0, right: 24, left: 0, bottom: 0 }} barCategoryGap={6}>
                  <CartesianGrid stroke={VIZ.grid} horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fill: VIZ.muted, fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" width={190} tick={{ fill: "#cbd5e1", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(148,163,184,0.08)" }} />
                  <Bar dataKey="count" name="Achados" fill={VIZ.series1} radius={[0, 4, 4, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>
      </div>

      {/* Tabela (também é a visão acessível dos dados) */}
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900 text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3">Nível</th>
              <th className="px-4 py-3">Achado</th>
              <th className="px-4 py-3">Projeto</th>
              <th className="px-4 py-3">{filters.status === "resolved" ? "Resolvido" : "Aberto há"}</th>
              <th className="px-4 py-3">Remediação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {groups.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">{loading ? "Carregando…" : findings.length === 0 ? "Nenhuma coleta ainda. Clique em “Coletar agora”." : "Nenhum achado com estes filtros."}</td></tr>
            )}
            {groups.map((g) => (
              <GroupRow key={g.key} g={g} projectName={projectName[g.project_id] ?? "–"} resolvedView={filters.status === "resolved"} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type Group = { key: string; project_id: string; title: string; level: Finding["level"]; items: Finding[] };

function GroupRow({ g, projectName, resolvedView }: { g: Group; projectName: string; resolvedView: boolean }) {
  const [open, setOpen] = useState(false);
  const oldest = g.items.reduce((a, b) => (a.first_seen_at < b.first_seen_at ? a : b));
  const url = g.items.find((i) => i.remediation_url)?.remediation_url;
  const many = g.items.length > 1;
  return (
    <>
      <tr className="bg-slate-950 align-top hover:bg-slate-900/50">
        <td className="px-4 py-3"><StatusBadge tone={LEVEL_TONE[g.level]} label={LEVEL_LABEL[g.level]} /></td>
        <td className="max-w-xl px-4 py-3">
          <div className="font-medium">
            {g.title}
            {many && <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-xs tabular-nums text-slate-300">{g.items.length}</span>}
          </div>
          {many ? (
            <button className="mt-0.5 text-xs text-slate-400 hover:text-slate-200" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
              {open ? "Ocultar ocorrências ▴" : `Ver ${g.items.length} ocorrências ▾`}
            </button>
          ) : (
            <div className="mt-0.5 text-xs text-slate-400">{clean(g.items[0].detail)}</div>
          )}
        </td>
        <td className="px-4 py-3 text-slate-300">{projectName}</td>
        <td className="px-4 py-3 tabular-nums text-slate-300">
          {resolvedView && oldest.resolved_at ? relativeTime(oldest.resolved_at) : `${ageDays(oldest.first_seen_at)} d`}
        </td>
        <td className="px-4 py-3">
          {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">Como corrigir ↗</a> : <span className="text-slate-600">–</span>}
        </td>
      </tr>
      {open && (
        <tr className="bg-slate-900/40">
          <td />
          <td colSpan={4} className="px-4 pb-3">
            <ul className="space-y-1 text-xs text-slate-400">
              {g.items.map((i) => <li key={i.id}>• {clean(i.detail)}</li>)}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

const clean = (s: string) => s.replace(/\\`/g, "`");

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void; children: React.ReactNode }) {
  return (
    <label className="min-w-40">
      <span className="label">{label}</span>
      <select className="input" value={value} onChange={onChange}>{children}</select>
    </label>
  );
}

function Empty({ loading }: { loading: boolean }) {
  return <div className="flex h-40 items-center justify-center text-sm text-slate-500">{loading ? "Carregando…" : "Sem achados abertos."}</div>;
}
