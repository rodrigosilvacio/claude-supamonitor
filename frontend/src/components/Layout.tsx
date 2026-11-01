import { NavLink, Outlet } from "react-router-dom";
import { supabase } from "../lib/supabase";

const NAV = [
  { to: "/", label: "Visão geral", end: true },
  { to: "/seguranca", label: "Segurança" },
  { to: "/projetos", label: "Projetos" },
  { to: "/alertas", label: "Alertas" },
  { to: "/configuracoes", label: "Configurações" },
];

export default function Layout({ email }: { email: string }) {
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-800 bg-slate-950 p-4 md:flex">
        <div className="mb-8 flex items-center gap-2 px-2">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px] shadow-emerald-400" />
          <span className="font-semibold tracking-tight">Supabase Monitor</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 text-sm ${isActive ? "bg-slate-800 text-white" : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"}`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-800 pt-4 text-xs text-slate-500">
          <div className="truncate" title={email}>{email}</div>
          <button className="mt-2 text-slate-400 hover:text-white" onClick={() => supabase.auth.signOut()}>Sair</button>
        </div>
      </aside>
      <div className="flex-1">
        <nav className="flex gap-3 overflow-x-auto border-b border-slate-800 p-3 text-sm md:hidden">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? "text-white" : "text-slate-400")}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <main className="mx-auto max-w-7xl p-6 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
