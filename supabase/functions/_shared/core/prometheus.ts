/**
 * Parser do formato texto de exposição do Prometheus (v0.0.4).
 * ÚNICO ponto que entende o formato bruto da Metrics API (beta): se o formato mudar, muda só aqui.
 * Módulo puro (sem APIs do Deno).
 */

export interface Sample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

export interface MetricFamilyInfo {
  type?: string;
  help?: string;
}

export interface ParsedMetrics {
  samples: Sample[];
  families: Map<string, MetricFamilyInfo>;
  /** Linhas que não puderam ser interpretadas (não derrubam o parse). */
  invalidLines: number;
}

function parseValue(raw: string): number {
  switch (raw) {
    case "NaN":
      return Number.NaN;
    case "+Inf":
    case "Inf":
      return Number.POSITIVE_INFINITY;
    case "-Inf":
      return Number.NEGATIVE_INFINITY;
    default:
      return Number(raw);
  }
}

/** Lê o bloco de labels a partir de `{`; devolve labels e o índice após `}`. Respeita escapes \" \\ \n. */
function parseLabels(line: string, start: number): { labels: Record<string, string>; end: number } | null {
  const labels: Record<string, string> = {};
  let i = start + 1;
  const n = line.length;
  while (i < n) {
    while (i < n && (line[i] === " " || line[i] === ",")) i++;
    if (line[i] === "}") return { labels, end: i + 1 };
    const keyMatch = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(line.slice(i));
    if (!keyMatch) return null;
    const key = keyMatch[0];
    i += key.length;
    while (line[i] === " ") i++;
    if (line[i] !== "=") return null;
    i++;
    while (line[i] === " ") i++;
    if (line[i] !== '"') return null;
    i++;
    let val = "";
    while (i < n && line[i] !== '"') {
      if (line[i] === "\\" && i + 1 < n) {
        const nx = line[i + 1];
        val += nx === "n" ? "\n" : nx;
        i += 2;
      } else {
        val += line[i++];
      }
    }
    if (line[i] !== '"') return null;
    i++;
    labels[key] = val;
  }
  return null;
}

export function parsePrometheus(text: string): ParsedMetrics {
  const samples: Sample[] = [];
  const families = new Map<string, MetricFamilyInfo>();
  let invalidLines = 0;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("#")) {
      const m = /^#\s*(HELP|TYPE)\s+([a-zA-Z_:][a-zA-Z0-9_:]*)\s*(.*)$/.exec(line);
      if (m) {
        const fam = families.get(m[2]) ?? {};
        if (m[1] === "TYPE") fam.type = m[3].trim();
        else fam.help = m[3];
        families.set(m[2], fam);
      }
      continue;
    }

    const nameMatch = /^[a-zA-Z_:][a-zA-Z0-9_:]*/.exec(line);
    if (!nameMatch) {
      invalidLines++;
      continue;
    }
    const name = nameMatch[0];
    let rest = line.slice(name.length);
    let labels: Record<string, string> = {};
    if (rest.startsWith("{")) {
      const parsed = parseLabels(rest, 0);
      if (!parsed) {
        invalidLines++;
        continue;
      }
      labels = parsed.labels;
      rest = rest.slice(parsed.end);
    }
    const parts = rest.trim().split(/\s+/);
    if (!parts[0]) {
      invalidLines++;
      continue;
    }
    const value = parseValue(parts[0]);
    if (Number.isNaN(value) && parts[0] !== "NaN") {
      invalidLines++;
      continue;
    }
    samples.push({ name, labels, value });
  }
  return { samples, families, invalidLines };
}
