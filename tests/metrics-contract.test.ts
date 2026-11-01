/**
 * TESTE DE CONTRATO da Metrics API (beta).
 * Fixture = nomes REAIS expostos pelo ClaudeProjects (capturados de monitor.metric_catalog).
 * Se o Supabase renomear/remover uma métrica que o monitor usa, este teste falha com o nome dela.
 * Para atualizar: select json_agg(metric_name order by metric_name) from monitor.metric_catalog;
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REQUIRED_METRICS } from "../supabase/functions/_shared/core/metrics.ts";

const real = JSON.parse(readFileSync(new URL("./fixtures/metrics_catalog_real.json", import.meta.url), "utf8")) as { metric_names: string[] };
const exposed = new Set(real.metric_names);

/** Métricas opcionais em que o cálculo dos indicadores depende hoje (validadas na saída real). */
const RELIED_OPTIONAL = ["pg_up", "max_connections_connection_count", "pg_database_size_bytes", "physical_replication_lag_physical_replication_lag_seconds", "pgbouncer_pools_client_active_connections"];

describe("contrato: Metrics API expõe as métricas que o monitor usa", () => {
  it.each([...REQUIRED_METRICS])("métrica obrigatória %s existe no endpoint", (m) => {
    expect(exposed.has(m), `A métrica obrigatória "${m}" sumiu da Metrics API. Atualize core/metrics.ts (mapeamento) antes de seguir.`).toBe(true);
  });

  it.each(RELIED_OPTIONAL)("métrica de apoio %s existe no endpoint", (m) => {
    expect(exposed.has(m), `A métrica "${m}" sumiu da Metrics API: o indicador correspondente ficará vazio.`).toBe(true);
  });

  it("o catálogo real tem o volume esperado (~200-400 séries de nomes)", () => {
    expect(real.metric_names.length).toBeGreaterThan(150);
  });
});
