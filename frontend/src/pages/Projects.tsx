import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { bytesToGb, gbToBytes, relativeTime } from "../lib/format";
import { ENV_LABEL, type ConnectionCheck, type Environment, type Project } from "../lib/types";

interface FormState {
  id?: string;
  name: string;
  project_ref: string;
  environment: Environment;
  db_quota_gb: string;
  max_connections: string;
  active: boolean;
  secret: string;
}

const EMPTY: FormState = { name: "", project_ref: "", environment: "prod", db_quota_gb: "", max_connections: "", active: true, secret: "" };

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, ConnectionCheck | "loading" | { error: string }>>({});

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("projects").select("*").order("name");
    if (error) setError("Não foi possível carregar os projetos.");
    setProjects((data as Project[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleActive(p: Project) {
    await supabase.from("projects").update({ active: !p.active }).eq("id", p.id);
    load();
  }

  async function remove(p: Project) {
    if (!window.confirm(`Excluir o projeto "${p.name}" do monitor? O histórico dele será apagado.`)) return;
    const { error } = await supabase.from("projects").delete().eq("id", p.id);
    if (error) setError("Falha ao excluir.");
    load();
  }

  async function test(p: Project) {
    setChecks((c) => ({ ...c, [p.id]: "loading" }));
    const { data, error } = await supabase.functions.invoke<ConnectionCheck>("monitor-test-connection", { body: { project_id: p.id } });
    setChecks((c) => ({ ...c, [p.id]: error || !data ? { error: "Falha ao chamar a função de teste." } : data }));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projetos</h1>
          <p className="text-sm text-slate-400">Projetos Supabase monitorados. O monitor só faz leituras (GET) neles.</p>
        </div>
        <button className="btn-primary" onClick={() => setForm({ ...EMPTY })}>Novo projeto</button>
      </div>

      {error && <div className="card border-rose-900 text-sm text-rose-300">{error}</div>}

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900 text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3">Projeto</th>
              <th className="px-4 py-3">Ambiente</th>
              <th className="px-4 py-3">Chave</th>
              <th className="px-4 py-3">Último scrape</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {loading && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">Carregando…</td></tr>
            )}
            {!loading && projects.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">Nenhum projeto cadastrado.</td></tr>
            )}
            {projects.map((p) => (
              <ProjectRow
                key={p.id}
                p={p}
                check={checks[p.id]}
                onEdit={() =>
                  setForm({
                    id: p.id,
                    name: p.name,
                    project_ref: p.project_ref,
                    environment: p.environment,
                    db_quota_gb: bytesToGb(p.db_quota_bytes),
                    max_connections: p.max_connections?.toString() ?? "",
                    active: p.active,
                    secret: "",
                  })
                }
                onToggle={() => toggleActive(p)}
                onDelete={() => remove(p)}
                onTest={() => test(p)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {form && <ProjectForm initial={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
    </div>
  );
}

function ProjectRow({ p, check, onEdit, onToggle, onDelete, onTest }: {
  p: Project;
  check: ConnectionCheck | "loading" | { error: string } | undefined;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onTest: () => void;
}) {
  return (
    <>
      <tr className="bg-slate-950 hover:bg-slate-900/50">
        <td className="px-4 py-3">
          <Link to={`/projetos/${p.id}`} className="font-medium hover:text-emerald-400">{p.name} →</Link>
          <div className="font-mono text-xs text-slate-500">{p.project_ref}</div>
        </td>
        <td className="px-4 py-3 text-slate-300">{ENV_LABEL[p.environment]}</td>
        <td className="px-4 py-3">
          {p.secret_configured ? <span className="text-emerald-400">configurada</span> : <span className="text-amber-400">pendente</span>}
        </td>
        <td className="px-4 py-3 text-slate-400">{relativeTime(p.last_scrape_at)}</td>
        <td className="px-4 py-3">
          <button onClick={onToggle} className={`rounded-full px-2.5 py-0.5 text-xs ${p.active ? "bg-emerald-950 text-emerald-300" : "bg-slate-800 text-slate-400"}`}>
            {p.active ? "ativo" : "inativo"}
          </button>
        </td>
        <td className="px-4 py-3">
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={onTest} disabled={check === "loading"}>{check === "loading" ? "Testando…" : "Testar conexão"}</button>
            <button className="btn-ghost" onClick={onEdit}>Editar</button>
            <button className="btn-danger" onClick={onDelete}>Excluir</button>
          </div>
        </td>
      </tr>
      {check && check !== "loading" && (
        <tr className="bg-slate-900/40">
          <td colSpan={6} className="px-4 py-3 text-sm">
            {"error" in check ? (
              <span className="text-rose-300">{check.error}</span>
            ) : (
              <div className="flex flex-wrap gap-6">
                <CheckBadge title="Metrics API" ok={check.metrics.ok} message={check.metrics.ok ? `${check.metrics.metricNames} métricas, ${check.metrics.seriesCount} séries (${check.metrics.durationMs} ms)` : check.metrics.message} />
                <CheckBadge title="Advisors (Management API)" ok={check.advisors.ok} message={check.advisors.ok ? `ok (${check.advisors.durationMs} ms)` : check.advisors.message} />
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function CheckBadge({ title, ok, message }: { title: string; ok: boolean; message: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2.5 w-2.5 rounded-full ${ok ? "bg-emerald-400" : "bg-rose-500"}`} />
      <span className="text-slate-300">{title}:</span>
      <span className={ok ? "text-slate-400" : "text-rose-300"}>{message}</span>
    </div>
  );
}

function ProjectForm({ initial, onClose, onSaved }: { initial: FormState; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<FormState>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = Boolean(f.id);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^[a-z]{20}$/.test(f.project_ref)) return setError("Project ref deve ter 20 letras minúsculas.");
    if (f.secret && !f.secret.startsWith("sb_secret_")) return setError("A chave deve ser uma Secret API key (sb_secret_...).");
    setBusy(true);

    const row = {
      name: f.name.trim(),
      project_ref: f.project_ref,
      environment: f.environment,
      db_quota_bytes: gbToBytes(f.db_quota_gb),
      max_connections: f.max_connections.trim() === "" ? null : Number(f.max_connections),
      active: f.active,
    };

    const res = editing
      ? await supabase.from("projects").update(row).eq("id", f.id!).select("id").single()
      : await supabase.from("projects").insert(row).select("id").single();

    if (res.error || !res.data) {
      setBusy(false);
      return setError(res.error?.code === "23505" ? "Este project ref já está cadastrado." : "Falha ao salvar o projeto.");
    }

    if (f.secret) {
      const { error } = await supabase.rpc("set_project_secret", { p_project_id: res.data.id, p_secret: f.secret });
      if (error) {
        setBusy(false);
        return setError("Projeto salvo, mas falhou ao gravar a chave no Vault.");
      }
    }
    setBusy(false);
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <form onSubmit={onSubmit} onClick={(e) => e.stopPropagation()} className="card w-full max-w-lg space-y-4 bg-slate-900">
        <h2 className="text-lg font-semibold">{editing ? "Editar projeto" : "Novo projeto"}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">Nome</label>
            <input className="input" required maxLength={120} value={f.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div>
            <label className="label">Project ref</label>
            <input className="input font-mono" required value={f.project_ref} onChange={(e) => set("project_ref", e.target.value.trim().toLowerCase())} placeholder="abcdefghijklmnopqrst" />
          </div>
          <div>
            <label className="label">Ambiente</label>
            <select className="input" value={f.environment} onChange={(e) => set("environment", e.target.value as Environment)}>
              {Object.entries(ENV_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Cota do banco (GB)</label>
            <input className="input" type="number" min="0" step="0.1" value={f.db_quota_gb} onChange={(e) => set("db_quota_gb", e.target.value)} placeholder="ex.: 0.5 no plano Free" />
          </div>
          <div>
            <label className="label">Máx. conexões (opcional)</label>
            <input className="input" type="number" min="1" value={f.max_connections} onChange={(e) => set("max_connections", e.target.value)} placeholder="fallback se a métrica faltar" />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Secret API key {editing && "(deixe vazio para manter)"}</label>
            <input className="input font-mono" type="password" autoComplete="off" value={f.secret} onChange={(e) => set("secret", e.target.value)} placeholder="sb_secret_..." />
            <p className="mt-1 text-xs text-slate-500">Gravada criptografada no Supabase Vault. Nunca é exibida de volta.</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300 sm:col-span-2">
            <input type="checkbox" checked={f.active} onChange={(e) => set("active", e.target.checked)} /> Monitoramento ativo
          </label>
        </div>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={busy}>{busy ? "Salvando…" : "Salvar"}</button>
        </div>
      </form>
    </div>
  );
}
