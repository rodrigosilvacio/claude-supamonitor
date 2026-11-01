import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCatalog, cpuPctBetween, extractSnapshot, parsePrometheus } from "../supabase/functions/_shared/core/metrics.ts";

const text = readFileSync(new URL("./fixtures/metrics_sample.txt", import.meta.url), "utf8");
const parsed = parsePrometheus(text);

describe("extractSnapshot", () => {
  const s = extractSnapshot(parsed, { prevCpu: { idle: 2000, total: 2300 } });

  it("conexões: soma de todos os bancos sobre max_connections da métrica", () => {
    expect(s.connections_used).toBe(21);
    expect(s.connections_max).toBe(60);
    expect(s.connections_used_pct).toBe(35);
  });

  it("tamanho do banco em bytes, disco do /data e memória", () => {
    expect(s.db_size_bytes).toBe(125829120);
    expect(s.disk_used_pct).toBe(25);
    expect(s.mem_used_pct).toBe(60);
  });

  it("CPU % pelo delta dos contadores (idle 2100 vs 2000; total 2400 vs 2300)", () => {
    expect(s.cpu_counters).toEqual({ idle: 2100, total: 2400 });
    expect(s.cpu_pct).toBe(0);
  });

  it("pg_up, pooler e lag ausente", () => {
    expect(s.pg_up).toBe(true);
    expect(s.pooler_connections).toBe(7);
    expect(s.replication_lag_s).toBeNull();
    expect(s.missing_required).toEqual([]);
  });

  it("sem max_connections na métrica usa o fallback do cadastro", () => {
    const noMax = parsePrometheus(text.replace(/^pg_settings_max_connections.*$/m, ""));
    const r = extractSnapshot(noMax, { maxConnectionsFallback: 42 });
    expect(r.connections_max).toBe(42);
    expect(r.connections_used_pct).toBe(50);
  });

  it("sem denominador nenhum, % fica null (nunca inventa)", () => {
    const noMax = parsePrometheus(text.replace(/^pg_settings_max_connections.*$/m, ""));
    expect(extractSnapshot(noMax).connections_used_pct).toBeNull();
  });

  it("pg_database_size_mb como alternativa", () => {
    const mb = parsePrometheus(text.replace(/^pg_database_size_bytes.*$/m, 'pg_database_size_mb{datname="postgres"} 100'));
    expect(extractSnapshot(mb).db_size_bytes).toBe(104857600);
  });
});

describe("cpuPctBetween", () => {
  it("calcula uso entre scrapes", () => expect(cpuPctBetween({ idle: 100, total: 200 }, { idle: 130, total: 300 })).toBe(70));
  it("primeiro scrape: null", () => expect(cpuPctBetween(null, { idle: 1, total: 2 })).toBeNull());
  it("reset de contador (reinício): null", () => expect(cpuPctBetween({ idle: 500, total: 900 }, { idle: 10, total: 20 })).toBeNull());
});

describe("buildCatalog", () => {
  it("lista nomes, tipo, chaves de label e quantidade de séries, sem valores", () => {
    const c = buildCatalog(parsed);
    const cpu = c.find((x) => x.metric_name === "node_cpu_seconds_total")!;
    expect(cpu).toMatchObject({ type: "counter", series: 5 });
    expect(cpu.label_keys).toEqual(["cpu", "mode", "supabase_project_ref"]);
    expect(JSON.stringify(c)).not.toContain("1100");
  });
});
