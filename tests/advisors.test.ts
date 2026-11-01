import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AdvisorFormatError,
  isCritical,
  normalizeAdvisors,
  planReconcile,
  stableStringify,
} from "../supabase/functions/_shared/core/advisors.ts";

const load = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8"));

describe("normalizeAdvisors", () => {
  it("formato agrupado (MCP): um achado por finding, com link de remediação", () => {
    const out = normalizeAdvisors(load("advisors_grouped.json"), "security");
    expect(out).toHaveLength(3);
    const rls = out.filter((f) => f.lint_name === "rls_disabled_in_public");
    expect(rls).toHaveLength(2);
    expect(rls[0]).toMatchObject({ level: "ERROR", category: "security", remediation_url: expect.stringMatching(/^https:\/\/supabase\.com\//) });
    expect(new Set(out.map((f) => f.fingerprint)).size).toBe(3);
  });

  it("formato plano (REST): usa cache_key como fingerprint", () => {
    const out = normalizeAdvisors(load("advisors_flat.json"), "performance");
    expect(out[0].fingerprint).toBe("ck:unindexed_foreign_keys_public_orders_orders_user_id_fkey");
    expect(out[0].detail).toContain("orders_user_id_fkey");
  });

  it("descarta link não-https e normaliza nível desconhecido para INFO", () => {
    const out = normalizeAdvisors(load("advisors_flat.json"), "performance");
    const bad = out.find((f) => f.lint_name === "suspicious")!;
    expect(bad.remediation_url).toBeNull();
    expect(bad.level).toBe("INFO");
  });

  it("fingerprint é estável independente da ordem das chaves", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
    const a = normalizeAdvisors([{ name: "x", metadata: { b: 1, a: 2 } }], "security");
    const b = normalizeAdvisors([{ name: "x", metadata: { a: 2, b: 1 } }], "security");
    expect(a[0].fingerprint).toBe(b[0].fingerprint);
  });

  it("aceita lista vazia e rejeita formato desconhecido", () => {
    expect(normalizeAdvisors({ lints: [] }, "security")).toEqual([]);
    expect(() => normalizeAdvisors({ foo: 1 }, "security")).toThrow(AdvisorFormatError);
  });
});

describe("planReconcile (critério: advisor novo vira open; se sumir, vira resolved)", () => {
  const findings = normalizeAdvisors(load("advisors_grouped.json"), "security");
  const [a, b, c] = findings;

  it("primeira coleta: tudo é inserido", () => {
    const p = planReconcile([], findings);
    expect(p.inserts).toHaveLength(3);
    expect(p.resolve).toEqual([]);
  });

  it("achado que some na coleta seguinte é resolvido", () => {
    const existing = findings.map((f) => ({ fingerprint: f.fingerprint, status: "open" as const }));
    const p = planReconcile(existing, [a, b]);
    expect(p.resolve).toEqual([c.fingerprint]);
    expect(p.refresh).toHaveLength(2);
    expect(p.inserts).toHaveLength(0);
  });

  it("achado resolvido que volta é reaberto", () => {
    const p = planReconcile([{ fingerprint: a.fingerprint, status: "resolved" }], [a]);
    expect(p.refresh).toHaveLength(1);
    expect(p.reopened).toBe(1);
  });

  it("achados já resolvidos não são resolvidos de novo", () => {
    const p = planReconcile([{ fingerprint: "old", status: "resolved" }], []);
    expect(p.resolve).toEqual([]);
  });
});

describe("isCritical", () => {
  it("ERROR de segurança é crítico; ERROR de performance não", () => {
    expect(isCritical({ category: "security", level: "ERROR" })).toBe(true);
    expect(isCritical({ category: "performance", level: "ERROR" })).toBe(false);
    expect(isCritical({ category: "security", level: "WARN" })).toBe(false);
  });
});
