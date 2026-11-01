import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import type { Project } from "../lib/types";

export default function Overview() {
  const [projects, setProjects] = useState<Project[] | null>(null);

  useEffect(() => {
    supabase.from("projects").select("*").order("name").then(({ data }) => setProjects((data as Project[]) ?? []));
  }, []);

  const total = projects?.length ?? 0;
  const active = projects?.filter((p) => p.active).length ?? 0;
  const configured = projects?.filter((p) => p.secret_configured).length ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Visão geral</h1>
        <p className="text-sm text-slate-400">Indicadores, faróis e gráficos entram nas etapas 2 a 5.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Projetos cadastrados" value={total} />
        <Kpi label="Ativos" value={active} />
        <Kpi label="Com chave configurada" value={`${configured}/${total}`} />
      </div>
      {projects && projects.length === 0 && (
        <div className="card text-sm text-slate-400">
          Nenhum projeto ainda. <Link to="/projetos" className="text-emerald-400 hover:underline">Cadastre o primeiro</Link>.
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-2 text-3xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
