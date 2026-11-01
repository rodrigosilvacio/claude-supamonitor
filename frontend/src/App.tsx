import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { configMissing, supabase } from "./lib/supabase";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import Projects from "./pages/Projects";
import Placeholder from "./pages/Placeholder";

function FullScreen({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center p-6">{children}</div>;
}

export default function App() {
  const auth = useAuth();

  if (configMissing) {
    return (
      <FullScreen>
        <div className="card max-w-md text-sm text-slate-300">
          Configuração ausente: defina <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>.
        </div>
      </FullScreen>
    );
  }
  if (auth.status === "loading") return <FullScreen><span className="text-slate-400">Carregando…</span></FullScreen>;
  if (auth.status === "anonymous") return <Login />;
  if (auth.status === "forbidden") {
    return (
      <FullScreen>
        <div className="card max-w-md space-y-4 text-center">
          <h1 className="text-lg font-semibold">Acesso restrito</h1>
          <p className="text-sm text-slate-400">Este usuário não tem permissão para o Supabase Monitor.</p>
          <button className="btn-ghost mx-auto" onClick={() => supabase.auth.signOut()}>Sair</button>
        </div>
      </FullScreen>
    );
  }

  // HashRouter: GitHub Pages não suporta rotas de SPA no servidor.
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout email={auth.session.user.email ?? ""} />}>
          <Route index element={<Overview />} />
          <Route path="seguranca" element={<Placeholder title="Segurança" stage="Etapa 2" description="Achados de segurança e performance de todos os projetos, com severidade, idade do achado e link de remediação." />} />
          <Route path="projetos" element={<Projects />} />
          <Route path="alertas" element={<Placeholder title="Alertas" stage="Etapa 4" description="Regras configuráveis, histórico de eventos e notificações por e-mail e WhatsApp." />} />
          <Route path="configuracoes" element={<Placeholder title="Configurações" stage="Etapa 4" description="Destinos de notificação e intervalos de coleta." />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
