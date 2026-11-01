import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

type AuthState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "forbidden"; session: Session }
  | { status: "admin"; session: Session };

const AuthContext = createContext<AuthState>({ status: "loading" });

async function resolve(session: Session | null): Promise<AuthState> {
  if (!session) return { status: "anonymous" };
  // O projeto hospedeiro tem outros usuários: só a allowlist monitor.admins entra.
  const { data, error } = await supabase.rpc("is_admin");
  return !error && data === true ? { status: "admin", session } : { status: "forbidden", session };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      const next = await resolve(data.session);
      if (alive) setState(next);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      // Evita chamar o Supabase dentro do callback (recomendação do supabase-js).
      setTimeout(async () => {
        const next = await resolve(session);
        if (alive) setState(next);
      }, 0);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
