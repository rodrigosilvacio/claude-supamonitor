import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { AdvisorCategory, ExistingFinding, NormalizedFinding } from "../supabase/functions/_shared/core/advisors.ts";
import { type AdvisorsRepo, type CollectionRun, collectProjectAdvisors } from "../supabase/functions/_shared/core/advisors-collector.ts";

const grouped = readFileSync(new URL("./fixtures/advisors_grouped.json", import.meta.url), "utf8");
const PROJECT = { id: "p1", project_ref: "abcdefghijklmnopqrst" };

/** Repositório em memória que imita a tabela monitor.advisor_findings. */
function memoryRepo() {
  const rows = new Map<string, { category: AdvisorCategory; status: "open" | "resolved"; first_seen: number }>();
  const runs: CollectionRun[] = [];
  let clock = 0;
  const repo: AdvisorsRepo = {
    async getExisting(_p, category) {
      return [...rows.entries()].filter(([, r]) => r.category === category).map(([fingerprint, r]): ExistingFinding => ({ fingerprint, status: r.status }));
    },
    async upsertOpen(_p, findings: NormalizedFinding[]) {
      clock++;
      for (const f of findings) {
        const cur = rows.get(f.fingerprint);
        rows.set(f.fingerprint, { category: f.category, status: "open", first_seen: cur?.first_seen ?? clock });
      }
    },
    async resolve(_p, fps) {
      for (const fp of fps) rows.get(fp)!.status = "resolved";
    },
    async logRun(r) {
      runs.push(r);
    },
  };
  return { repo, rows, runs };
}

const respond = (security: () => Response, performance: () => Response = () => new Response('{"lints":[]}', { status: 200 })) =>
  vi.fn(async (url: string) => (url.endsWith("/security") ? security() : performance()));

describe("collectProjectAdvisors", () => {
  it("Given advisor novo, Then fica open; When some na coleta seguinte, Then vira resolved", async () => {
    const { repo, rows } = memoryRepo();
    await collectProjectAdvisors(PROJECT, "sbp_x", repo, { fetchImpl: respond(() => new Response(grouped, { status: 200 })) });
    expect([...rows.values()].filter((r) => r.status === "open")).toHaveLength(3);

    const reduced = JSON.parse(grouped);
    reduced.result.lints = reduced.result.lints.slice(0, 1); // só o lint de RLS (2 achados)
    const res = await collectProjectAdvisors(PROJECT, "sbp_x", repo, { fetchImpl: respond(() => new Response(JSON.stringify(reduced), { status: 200 })) });
    expect(res[0]).toMatchObject({ ok: true, resolved: 1, total: 2 });
    expect([...rows.values()].filter((r) => r.status === "resolved")).toHaveLength(1);
  });

  it("first_seen_at é preservado entre coletas", async () => {
    const { repo, rows } = memoryRepo();
    const f = respond(() => new Response(grouped, { status: 200 }));
    await collectProjectAdvisors(PROJECT, "sbp_x", repo, { fetchImpl: f });
    await collectProjectAdvisors(PROJECT, "sbp_x", repo, { fetchImpl: f });
    expect([...rows.values()].every((r) => r.first_seen === 1)).toBe(true);
  });

  it("falha HTTP NÃO resolve achados e registra a execução como falha", async () => {
    const { repo, rows, runs } = memoryRepo();
    await collectProjectAdvisors(PROJECT, "sbp_x", repo, { fetchImpl: respond(() => new Response(grouped, { status: 200 })) });
    await collectProjectAdvisors(PROJECT, "sbp_x", repo, { fetchImpl: respond(() => new Response("boom", { status: 500 })) });
    expect([...rows.values()].every((r) => r.status === "open")).toBe(true);
    expect(runs.at(-2)).toMatchObject({ kind: "advisors_security", ok: false, http_status: 500 });
  });

  it("resposta em formato inesperado não resolve nada", async () => {
    const { repo, rows } = memoryRepo();
    await collectProjectAdvisors(PROJECT, "sbp_x", repo, { fetchImpl: respond(() => new Response(grouped, { status: 200 })) });
    const r = await collectProjectAdvisors(PROJECT, "sbp_x", repo, { fetchImpl: respond(() => new Response('{"mudou":true}', { status: 200 })) });
    expect(r[0].ok).toBe(false);
    expect([...rows.values()].every((x) => x.status === "open")).toBe(true);
  });

  it("falha de rede em segurança não impede performance", async () => {
    const { repo, runs } = memoryRepo();
    const f = respond(() => {
      throw new TypeError("net");
    });
    const r = await collectProjectAdvisors(PROJECT, "sbp_x", repo, { fetchImpl: f });
    expect(r.map((x) => x.ok)).toEqual([false, true]);
    expect(runs).toHaveLength(2);
  });

  it("sem PAT: não faz requisição e registra o motivo", async () => {
    const { repo, runs } = memoryRepo();
    const f = vi.fn();
    await collectProjectAdvisors(PROJECT, null, repo, { fetchImpl: f });
    expect(f).not.toHaveBeenCalled();
    expect(runs[0].message).toContain("PAT");
  });
});
