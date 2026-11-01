/**
 * Guardrails estáticos das migrations (o projeto hospedeiro é compartilhado):
 *  - toda tabela criada fica no schema `monitor` e tem RLS habilitado;
 *  - nenhuma DDL/DML fora do schema `monitor` (exceto vault.* via funções).
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));
const strip = (sql: string) => sql.replace(/--.*$/gm, "");

describe.each(files)("migration %s", (file) => {
  const sql = strip(readFileSync(join(dir, file), "utf8")).toLowerCase();

  it("só cria tabelas no schema monitor, todas com RLS", () => {
    const tables = [...sql.matchAll(/create table (?:if not exists )?([a-z_.]+)/g)].map((m) => m[1]);
    for (const t of tables) {
      expect(t.startsWith("monitor."), `tabela fora do schema monitor: ${t}`).toBe(true);
      expect(sql, `RLS ausente em ${t}`).toContain(`alter table ${t} enable row level security`);
    }
  });

  it("não altera objetos fora do schema monitor", () => {
    const forbidden = /(create|alter|drop|truncate)\s+(table|view|function|trigger|policy|index|schema)\s+(if (not )?exists\s+)?(public|auth|storage|realtime|extensions)\./;
    expect(sql).not.toMatch(forbidden);
    expect(sql).not.toMatch(/\b(insert into|update|delete from)\s+(public|auth|storage)\./);
    expect(sql).not.toMatch(/\bdrop\s+(schema|table)\b/);
  });

  it("anon nunca recebe acesso ao schema monitor", () => {
    expect(sql).not.toMatch(/grant[^;]*\bto\b[^;]*\banon\b/);
  });
});
