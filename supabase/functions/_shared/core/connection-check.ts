/**
 * Lógica pura do botão "Testar conexão": consulta a Metrics API e os advisors
 * (somente GET) e resume o resultado SEM devolver corpo bruto nem segredos.
 */
import {
  advisorsUrl,
  type FetchLike,
  managementAuthHeader,
  metricsAuthHeader,
  metricsUrl,
  readOnlyGet,
} from "./readonly.ts";

export interface CheckPart {
  ok: boolean;
  status: number;
  durationMs: number;
  message: string;
}

export interface ConnectionCheck {
  metrics: CheckPart & { seriesCount: number; metricNames: number };
  advisors: CheckPart;
}

export function describeStatus(status: number, error?: string): string {
  if (error) return error;
  if (status >= 200 && status < 300) return "ok";
  if (status === 401) return "não autorizado: verifique a chave/token";
  if (status === 403) return "acesso negado";
  if (status === 404) return "endpoint não encontrado (projeto pausado ou ref incorreto?)";
  if (status === 429) return "limite de requisições atingido";
  if (status >= 500) return "erro no servidor Supabase";
  return `HTTP ${status}`;
}

/** Conta séries e nomes de métricas distintos em um texto Prometheus (sem guardar valores). */
export function summarizePrometheusText(text: string): { seriesCount: number; metricNames: number } {
  const names = new Set<string>();
  let series = 0;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^([a-zA-Z_:][a-zA-Z0-9_:]*)/.exec(line);
    if (m) {
      series++;
      names.add(m[1]);
    }
  }
  return { seriesCount: series, metricNames: names.size };
}

export async function checkConnection(
  ref: string,
  creds: { secretKey: string | null; pat: string | null },
  fetchImpl?: FetchLike,
): Promise<ConnectionCheck> {
  let metrics: ConnectionCheck["metrics"];
  if (!creds.secretKey) {
    metrics = { ok: false, status: 0, durationMs: 0, message: "Secret key não cadastrada", seriesCount: 0, metricNames: 0 };
  } else {
    const r = await readOnlyGet(metricsUrl(ref), metricsAuthHeader(creds.secretKey), { fetchImpl });
    const summary = r.ok ? summarizePrometheusText(r.body) : { seriesCount: 0, metricNames: 0 };
    metrics = { ok: r.ok, status: r.status, durationMs: r.durationMs, message: describeStatus(r.status, r.error), ...summary };
  }

  let advisors: CheckPart;
  if (!creds.pat) {
    advisors = { ok: false, status: 0, durationMs: 0, message: "MONITOR_SUPABASE_PAT não configurado" };
  } else {
    const r = await readOnlyGet(advisorsUrl(ref, "security"), managementAuthHeader(creds.pat), { fetchImpl });
    advisors = { ok: r.ok, status: r.status, durationMs: r.durationMs, message: describeStatus(r.status, r.error) };
  }

  return { metrics, advisors };
}
