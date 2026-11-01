import { describe, expect, it } from "vitest";
import { computeKpis, type Finding, openTrend, securityLight, topLints } from "../frontend/src/lib/security.ts";

const NOW = new Date("2026-11-10T12:00:00Z").getTime();
const D = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString();

let n = 0;
const f = (p: Partial<Finding>): Finding => ({
  id: String(++n), project_id: "p1", category: "security", lint_name: "x", title: "X", level: "WARN", detail: "",
  remediation_url: null, status: "open", first_seen_at: D(1), last_seen_at: D(0), resolved_at: null, ...p,
});

describe("securityLight", () => {
  it("crítico aberto => vermelho", () => expect(securityLight([f({ level: "ERROR" })])).toBe("critical"));
  it("ERROR de performance não é crítico => amarelo", () => expect(securityLight([f({ level: "ERROR", category: "performance" })])).toBe("warning"));
  it("só INFO => verde", () => expect(securityLight([f({ level: "INFO" })])).toBe("ok"));
  it("nenhum => verde", () => expect(securityLight([])).toBe("ok"));
});

describe("computeKpis", () => {
  it("conta críticos, abertos, resolvidos em 30 dias e idade média", () => {
    const k = computeKpis([
      f({ level: "ERROR", first_seen_at: D(10) }),
      f({ level: "ERROR", first_seen_at: D(4) }),
      f({ level: "WARN" }),
      f({ status: "resolved", resolved_at: D(5) }),
      f({ status: "resolved", resolved_at: D(40) }),
    ], NOW);
    expect(k).toEqual({ criticalOpen: 2, open: 3, resolved30d: 1, avgCriticalAgeDays: 7 });
  });
  it("sem críticos, idade média é null", () => expect(computeKpis([], NOW).avgCriticalAgeDays).toBeNull());
});

describe("openTrend", () => {
  it("reconstrói abertos por dia a partir de first_seen/resolved", () => {
    const t = openTrend([f({ level: "ERROR", first_seen_at: D(5) }), f({ first_seen_at: D(5), status: "resolved", resolved_at: D(2) })], 7, NOW);
    expect(t).toHaveLength(7);
    expect(t[0]).toMatchObject({ open: 0, critical: 0 }); // 6 dias atrás
    expect(t[1]).toMatchObject({ open: 2, critical: 1 }); // 5 dias atrás
    expect(t.at(-1)).toMatchObject({ open: 1, critical: 1 }); // hoje
  });
});

describe("topLints", () => {
  it("ordena por quantidade e marca críticos", () => {
    const r = topLints([f({ title: "A" }), f({ title: "B", level: "ERROR" }), f({ title: "B" })], 5);
    expect(r[0]).toEqual({ name: "B", count: 2, critical: true });
  });
});
