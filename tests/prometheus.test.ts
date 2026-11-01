import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePrometheus } from "../supabase/functions/_shared/core/prometheus.ts";

const text = readFileSync(new URL("./fixtures/metrics_sample.txt", import.meta.url), "utf8");

describe("parsePrometheus", () => {
  const p = parsePrometheus(text);

  it("lê amostras, labels e TYPE/HELP", () => {
    const up = p.samples.find((s) => s.name === "pg_up")!;
    expect(up.value).toBe(1);
    expect(up.labels.service_type).toBe("db");
    expect(p.families.get("node_cpu_seconds_total")?.type).toBe("counter");
    expect(p.families.get("pg_up")?.help).toContain("PostgreSQL");
  });

  it("interpreta notação científica", () => {
    const size = p.samples.find((s) => s.name === "pg_database_size_bytes")!;
    expect(size.value).toBe(125829120);
  });

  it("respeita escapes em labels e valores especiais", () => {
    const w = p.samples.find((s) => s.name === "weird_metric")!;
    expect(w.labels.path).toBe("C:\\temp");
    expect(w.labels.msg).toBe('aspas "x"\nfim');
    expect(Number.isNaN(w.value)).toBe(true);
    expect(p.samples.find((s) => s.name === "inf_metric")!.value).toBe(Number.POSITIVE_INFINITY);
  });

  it("linha inválida é contada e não derruba o parse", () => {
    expect(p.invalidLines).toBe(1);
    expect(p.samples.length).toBeGreaterThan(15);
  });

  it("texto vazio devolve zero amostras", () => {
    expect(parsePrometheus("").samples).toEqual([]);
  });
});
