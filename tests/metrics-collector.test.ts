import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { CpuCounters } from "../supabase/functions/_shared/core/metrics.ts";
import { type MetricsRepo, scrapeProject, type SnapshotRow } from "../supabase/functions/_shared/core/metrics-collector.ts";

const text = readFileSync(new URL("./fixtures/metrics_sample.txt", import.meta.url), "utf8");
const PROJECT = { id: "p1", project_ref: "abcdefghijklmnopqrst", max_connections: null };

function memoryRepo() {
  const snapshots: SnapshotRow[] = [];
  const failures: string[] = [];
  let consecutive = 0;
  let catalogWrites = 0;
  const repo: MetricsRepo = {
    async previousCpu() {
      const last = [...snapshots].reverse().find((s) => s.raw_subset.cpu);
      return (last?.raw_subset.cpu as CpuCounters) ?? null;
    },
    async insertSnapshot(r) {
      snapshots.push(r);
    },
    async markScrape(_p, ok) {
      consecutive = ok ? 0 : consecutive + 1;
      return consecutive;
    },
    async catalogIsStale() {
      return catalogWrites === 0;
    },
    async upsertCatalog() {
      catalogWrites++;
    },
    async logFailure(_p, m) {
      failures.push(m);
    },
  };
  return { repo, snapshots, failures, get catalogWrites() { return catalogWrites; } };
}

const ok = () => vi.fn(async () => new Response(text, { status: 200 }));

describe("scrapeProject", () => {
  it("Given projeto ativo, When scrape, Then snapshot com scrape_ok=true", async () => {
    const m = memoryRepo();
    const r = await scrapeProject(PROJECT, "sb_secret_x", m.repo, { fetchImpl: ok() });
    expect(r.ok).toBe(true);
    expect(m.snapshots[0]).toMatchObject({ scrape_ok: true, connections_used_pct: 35, error: null });
    expect(m.catalogWrites).toBe(1);
  });

  it("CPU aparece a partir do segundo scrape", async () => {
    const m = memoryRepo();
    await scrapeProject(PROJECT, "sb_secret_x", m.repo, { fetchImpl: ok() });
    const bumped = text.replace('cpu="0",mode="idle",supabase_project_ref="abcdefghijklmnopqrst"} 1000', 'cpu="0",mode="idle",supabase_project_ref="abcdefghijklmnopqrst"} 1030').replace('cpu="0",mode="user",supabase_project_ref="abcdefghijklmnopqrst"} 150', 'cpu="0",mode="user",supabase_project_ref="abcdefghijklmnopqrst"} 220');
    await scrapeProject(PROJECT, "sb_secret_x", m.repo, { fetchImpl: vi.fn(async () => new Response(bumped, { status: 200 })) });
    expect(m.snapshots[0].cpu_pct).toBeNull();
    expect(m.snapshots[1].cpu_pct).toBe(70);
  });

  it("Given 3 falhas seguidas, Then contador chega a 3 (base do alerta 'fora do ar')", async () => {
    const m = memoryRepo();
    const down = vi.fn(async () => new Response("bad gateway", { status: 502 }));
    let r;
    for (let i = 0; i < 3; i++) r = await scrapeProject(PROJECT, "sb_secret_x", m.repo, { fetchImpl: down });
    expect(r!.consecutiveFailures).toBe(3);
    expect(m.snapshots.every((s) => s.scrape_ok === false)).toBe(true);
    expect(m.failures).toHaveLength(3);
  });

  it("sucesso zera o contador de falhas", async () => {
    const m = memoryRepo();
    await scrapeProject(PROJECT, "sb_secret_x", m.repo, { fetchImpl: vi.fn(async () => new Response("", { status: 500 })) });
    const r = await scrapeProject(PROJECT, "sb_secret_x", m.repo, { fetchImpl: ok() });
    expect(r.consecutiveFailures).toBe(0);
  });

  it("pg_up = 0 conta como falha mesmo com HTTP 200", async () => {
    const m = memoryRepo();
    const r = await scrapeProject(PROJECT, "sb_secret_x", m.repo, { fetchImpl: vi.fn(async () => new Response(text.replace(/^pg_up\{(.*)\} 1$/m, "pg_up{$1} 0"), { status: 200 })) });
    expect(r.ok).toBe(false);
    expect(m.snapshots[0]).toMatchObject({ scrape_ok: false, error: "banco fora do ar (pg_up = 0)" });
  });

  it("falha de rede não lança e vira snapshot de falha", async () => {
    const m = memoryRepo();
    const r = await scrapeProject(PROJECT, "sb_secret_x", m.repo, { fetchImpl: vi.fn(async () => { throw new TypeError("x"); }) });
    expect(r).toMatchObject({ ok: false, message: "falha de rede", consecutiveFailures: 1 });
  });

  it("sem chave: não faz requisição", async () => {
    const m = memoryRepo();
    const f = vi.fn();
    const r = await scrapeProject(PROJECT, null, m.repo, { fetchImpl: f });
    expect(f).not.toHaveBeenCalled();
    expect(r.message).toContain("Secret key");
  });

  it("nunca grava a chave no snapshot", async () => {
    const m = memoryRepo();
    await scrapeProject(PROJECT, "sb_secret_supersecreta_123", m.repo, { fetchImpl: ok() });
    expect(JSON.stringify(m.snapshots)).not.toContain("sb_secret_supersecreta_123");
  });
});
