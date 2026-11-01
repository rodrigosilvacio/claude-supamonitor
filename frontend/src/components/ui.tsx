import type { ReactNode } from "react";

/** Tokens de dados (paleta de referência validada no fundo escuro; status é escala fixa). */
export const VIZ = {
  series1: "#3987e5", // azul
  series2: "#d95926", // laranja
  critical: "#d03b3b",
  warning: "#fab219",
  good: "#0ca30c",
  info: "#898781",
  grid: "#1e293b",
  axis: "#334155",
  muted: "#94a3b8",
};

type Tone = "critical" | "warning" | "good" | "info";

const TONE: Record<Tone, { color: string; icon: string }> = {
  critical: { color: VIZ.critical, icon: "✕" },
  warning: { color: VIZ.warning, icon: "!" },
  good: { color: VIZ.good, icon: "✓" },
  info: { color: VIZ.info, icon: "i" },
};

/** Status sempre com ícone + rótulo (nunca só cor). */
export function StatusBadge({ tone, label }: { tone: Tone; label: string }) {
  const t = TONE[tone];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-xs text-slate-200">
      <span className="flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-slate-950" style={{ background: t.color }} aria-hidden>
        {t.icon}
      </span>
      {label}
    </span>
  );
}

export function Kpi({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: Tone }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
        {tone && <span className="h-2 w-2 rounded-full" style={{ background: TONE[tone].color }} aria-hidden />}
      </div>
      <div className="mt-2 text-3xl font-semibold">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export function ChartCard({ title, subtitle, children, legend }: { title: string; subtitle?: string; children: ReactNode; legend?: ReactNode }) {
  return (
    <div className="card">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
        {legend}
      </div>
      {children}
    </div>
  );
}

export function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-300">
      <span className="h-0.5 w-4 rounded" style={{ background: color }} aria-hidden />
      {label}
    </span>
  );
}

export function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-950/95 px-3 py-2 text-xs shadow-xl">
      {label && <div className="mb-1 text-slate-400">{label}</div>}
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 text-slate-100">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} aria-hidden />
          <span className="text-slate-300">{p.name}:</span>
          <span className="font-medium tabular-nums">{p.value}</span>
        </div>
      ))}
    </div>
  );
}
