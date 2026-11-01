import { describe, expect, it, vi } from "vitest";
import { checkConnection, describeStatus, summarizePrometheusText } from "../supabase/functions/_shared/core/connection-check.ts";

const REF = "abcdefghijklmnopqrst";
const PROM = `# HELP pg_up up\n# TYPE pg_up gauge\npg_up{a="1"} 1\npg_database_size_mb{db="postgres"} 12.5\npg_database_size_mb{db="x"} 1\n`;

describe("summarizePrometheusText", () => {
  it("conta séries e nomes distintos ignorando comentários", () => {
    expect(summarizePrometheusText(PROM)).toEqual({ seriesCount: 3, metricNames: 2 });
  });
});

describe("checkConnection (mock, nunca bate em produção)", () => {
  it("sucesso nas duas fontes sem vazar corpo nem segredo", async () => {
    const f = vi.fn(async (url: string) =>
      url.includes("metrics") ? new Response(PROM, { status: 200 }) : new Response("[]", { status: 200 }),
    );
    const r = await checkConnection(REF, { secretKey: "sb_secret_supersecreto", pat: "sbp_tokensecreto123" }, f);
    expect(r.metrics).toMatchObject({ ok: true, seriesCount: 3, metricNames: 2, message: "ok" });
    expect(r.advisors).toMatchObject({ ok: true, message: "ok" });
    const serialized = JSON.stringify(r);
    expect(serialized).not.toContain("sb_secret_supersecreto");
    expect(serialized).not.toContain("sbp_tokensecreto123");
    expect(serialized).not.toContain("pg_up");
  });

  it("sem credenciais não faz requisição", async () => {
    const f = vi.fn();
    const r = await checkConnection(REF, { secretKey: null, pat: null }, f);
    expect(f).not.toHaveBeenCalled();
    expect(r.metrics.ok).toBe(false);
    expect(r.advisors.ok).toBe(false);
  });

  it("401 vira mensagem amigável", async () => {
    const f = vi.fn(async () => new Response("unauthorized", { status: 401 }));
    const r = await checkConnection(REF, { secretKey: "sb_secret_x_1234567890", pat: "sbp_x_1234567890" }, f);
    expect(r.metrics.message).toContain("não autorizado");
    expect(describeStatus(429)).toContain("limite");
  });
});
