/**
 * Cliente HTTP somente leitura para projetos Supabase monitorados.
 *
 * Regra inegociável: o monitor NUNCA escreve em projetos monitorados.
 * Este módulo garante isso por construção:
 *   1. o método é sempre GET (não existe parâmetro de método);
 *   2. a URL precisa casar com uma allowlist explícita de endpoints de leitura.
 *
 * Módulo puro (sem APIs do Deno): testado com Vitest em Node.
 */

export const PROJECT_REF_RE = /^[a-z]{20}$/;

export function isValidProjectRef(ref: string): boolean {
  return PROJECT_REF_RE.test(ref);
}

/** Endpoints permitidos. Fontes: docs oficiais da Metrics API e da Management API. */
const ALLOWED_URL_PATTERNS: RegExp[] = [
  // Metrics API (Prometheus): https://<ref>.supabase.co/customer/v1/privileged/metrics
  /^https:\/\/[a-z]{20}\.supabase\.co\/customer\/v1\/privileged\/metrics$/,
  // Management API, advisors (experimental): GET /v1/projects/{ref}/advisors/{security|performance}
  /^https:\/\/api\.supabase\.com\/v1\/projects\/[a-z]{20}\/advisors\/(security|performance)(\?lint_type=[a-z_]+)?$/,
];

export function isAllowedUrl(url: string): boolean {
  return ALLOWED_URL_PATTERNS.some((re) => re.test(url));
}

export function metricsUrl(ref: string): string {
  assertRef(ref);
  return `https://${ref}.supabase.co/customer/v1/privileged/metrics`;
}

export function advisorsUrl(ref: string, kind: "security" | "performance"): string {
  assertRef(ref);
  return `https://api.supabase.com/v1/projects/${ref}/advisors/${kind}`;
}

function assertRef(ref: string): void {
  if (!isValidProjectRef(ref)) throw new Error("project_ref inválido");
}

export type FetchLike = (input: string, init: { method: "GET"; headers: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;

export class ForbiddenUrlError extends Error {
  constructor() {
    super("URL fora da allowlist de leitura");
    this.name = "ForbiddenUrlError";
  }
}

export interface ReadResult {
  ok: boolean;
  status: number;
  durationMs: number;
  body: string;
  error?: string;
}

/**
 * Faz um GET em uma URL da allowlist. Nunca lança por falha de rede/HTTP:
 * devolve ok=false com o motivo (falha de coleta nunca derruba o app).
 * Lança apenas ForbiddenUrlError (erro de programação).
 */
export async function readOnlyGet(
  url: string,
  headers: Record<string, string>,
  opts: { fetchImpl?: FetchLike; timeoutMs?: number; now?: () => number } = {},
): Promise<ReadResult> {
  if (!isAllowedUrl(url)) throw new ForbiddenUrlError();
  const fetchImpl = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  const now = opts.now ?? (() => Date.now());
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = now();
  try {
    const res = await fetchImpl(url, { method: "GET", headers, signal: controller.signal });
    const body = await res.text();
    return { ok: res.ok, status: res.status, durationMs: now() - started, body };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      status: 0,
      durationMs: now() - started,
      body: "",
      error: aborted ? `timeout após ${timeoutMs} ms` : "falha de rede",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Header Basic Auth da Metrics API: usuário fixo `service_role`, senha = Secret API key. */
export function metricsAuthHeader(secretKey: string): Record<string, string> {
  return { Authorization: `Basic ${btoa(`service_role:${secretKey}`)}` };
}

/** Header Bearer da Management API (Personal Access Token). */
export function managementAuthHeader(pat: string): Record<string, string> {
  return { Authorization: `Bearer ${pat}` };
}

/** Remove qualquer ocorrência de segredos conhecidos de um texto antes de logar/retornar. */
export function redact(text: string, secrets: Array<string | undefined | null>): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 8) out = out.split(s).join("[REDACTED]");
  }
  return out;
}
