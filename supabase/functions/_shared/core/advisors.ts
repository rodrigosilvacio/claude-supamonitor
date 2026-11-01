/**
 * Normalização e reconciliação de advisors (Management API, endpoint experimental).
 *
 * A doc oficial não publica o schema da resposta. Validamos dois formatos:
 *  - "plano": cada lint é um achado, com detail/metadata/cache_key próprios;
 *  - "agrupado": cada lint traz `findings: [{ detail, metadata }]` (formato do MCP get_advisors).
 * Aceitamos `{ lints: [...] }`, `{ result: { lints: [...] } }` ou um array direto.
 *
 * Módulo puro (sem APIs do Deno).
 */

export type AdvisorCategory = "security" | "performance";
export type AdvisorLevel = "ERROR" | "WARN" | "INFO";

export interface NormalizedFinding {
  category: AdvisorCategory;
  lint_name: string;
  title: string;
  level: AdvisorLevel;
  facing: string | null;
  detail: string;
  remediation_url: string | null;
  metadata: Record<string, unknown>;
  fingerprint: string;
}

export class AdvisorFormatError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "AdvisorFormatError";
  }
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

function extractLints(payload: unknown): Json[] {
  if (Array.isArray(payload)) return payload.filter(isObj);
  if (isObj(payload)) {
    if (Array.isArray(payload.lints)) return payload.lints.filter(isObj);
    if (isObj(payload.result) && Array.isArray(payload.result.lints)) return payload.result.lints.filter(isObj);
  }
  throw new AdvisorFormatError("resposta de advisors sem lista de lints");
}

function normLevel(v: unknown): AdvisorLevel {
  const s = String(v ?? "").toUpperCase();
  return s === "ERROR" || s === "WARN" ? s : "INFO";
}

/** Só aceita links https (evita javascript: e afins no frontend). */
function safeUrl(v: unknown): string | null {
  const s = str(v);
  return s && /^https:\/\//i.test(s) ? s : null;
}

/** JSON estável (chaves ordenadas) para gerar fingerprint determinístico. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (isObj(v)) {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** FNV-1a 32 bits em hex: suficiente para identificar achados dentro de um projeto. */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function fingerprintOf(category: AdvisorCategory, name: string, metadata: Json, cacheKey: string | null): string {
  if (cacheKey) return `ck:${cacheKey}`;
  return `fp:${category}:${name}:${fnv1a(stableStringify(metadata))}`;
}

export function normalizeAdvisors(payload: unknown, category: AdvisorCategory): NormalizedFinding[] {
  const out = new Map<string, NormalizedFinding>();
  for (const lint of extractLints(payload)) {
    const name = str(lint.name) ?? "desconhecido";
    const base = {
      category,
      lint_name: name,
      title: str(lint.title) ?? name,
      level: normLevel(lint.level),
      facing: str(lint.facing),
      remediation_url: safeUrl(lint.remediation),
    };
    const children: Json[] = Array.isArray(lint.findings) ? lint.findings.filter(isObj) : [lint];
    for (const child of children) {
      const metadata = isObj(child.metadata) ? child.metadata : {};
      const f: NormalizedFinding = {
        ...base,
        detail: (str(child.detail) ?? str(lint.description) ?? "").slice(0, 2000),
        metadata,
        fingerprint: fingerprintOf(category, name, metadata, str(child.cache_key)),
      };
      out.set(f.fingerprint, f);
    }
  }
  return [...out.values()];
}

export interface ExistingFinding {
  fingerprint: string;
  status: "open" | "resolved";
}

export interface ReconcilePlan {
  /** Achados novos (inserir com first_seen_at = agora). */
  inserts: NormalizedFinding[];
  /** Achados já conhecidos que continuam presentes (atualizar last_seen_at; reabrir se estavam resolvidos). */
  refresh: NormalizedFinding[];
  /** Fingerprints abertos que sumiram nesta coleta: viram `resolved`. */
  resolve: string[];
  reopened: number;
}

/**
 * Reconciliação de uma coleta BEM-SUCEDIDA de uma categoria.
 * Nunca chame com coleta falha: sumiço por erro de rede não pode resolver achados.
 */
export function planReconcile(existing: ExistingFinding[], incoming: NormalizedFinding[]): ReconcilePlan {
  const known = new Map(existing.map((e) => [e.fingerprint, e.status]));
  const incomingSet = new Set(incoming.map((f) => f.fingerprint));
  const inserts: NormalizedFinding[] = [];
  const refresh: NormalizedFinding[] = [];
  let reopened = 0;
  for (const f of incoming) {
    const st = known.get(f.fingerprint);
    if (st === undefined) inserts.push(f);
    else {
      refresh.push(f);
      if (st === "resolved") reopened++;
    }
  }
  const resolve = existing.filter((e) => e.status === "open" && !incomingSet.has(e.fingerprint)).map((e) => e.fingerprint);
  return { inserts, refresh, resolve, reopened };
}

/** "Crítico" = nível ERROR na categoria segurança (decisão de produto). */
export const isCritical = (f: { category: string; level: string }) => f.category === "security" && f.level === "ERROR";
