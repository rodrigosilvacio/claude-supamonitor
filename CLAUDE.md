# CLAUDE.md: Supabase Monitor

## Objetivo
Painel web (GitHub Pages) que centraliza o monitoramento de vários projetos Supabase:
saúde do banco (Metrics API), achados de segurança e performance (Advisors) e alertas
automáticos (e-mail via Resend e WhatsApp via webhook). Usuário único: o admin
(rodrigosilvapmp@hotmail.com), controlado pelo Supabase Auth + allowlist `monitor.admins`.

## Arquitetura
- **Frontend**: `frontend/` (React + Vite + TS + Tailwind + Recharts), publicado no GitHub Pages
  pelo workflow `.github/workflows/ci-pages.yml`. Usa `HashRouter`.
- **Backend**: projeto Supabase **ClaudeProjects** (`xtrvojnauvkkterogrst`), compartilhado com outros apps.
  - Schema isolado `monitor` (migrations em `supabase/migrations/`).
  - Edge Functions com prefixo `monitor-` (`supabase/functions/`).
  - Segredos dos projetos monitorados no **Supabase Vault**; PAT e chaves de notificação como secrets das Edge Functions.
  - Agendamento com `pg_cron` + `pg_net` (etapas 2+).
- **Núcleo puro e testável**: `supabase/functions/_shared/core/` (sem APIs do Deno), testado com Vitest em Node.

## Comandos
| Ação | Comando |
|---|---|
| Instalar (raiz, testes do núcleo) | `npm install` |
| Testes do núcleo | `npm test` |
| Typecheck do núcleo | `npm run typecheck` |
| Frontend dev | `cd frontend && npm install && npm run dev` (precisa de `frontend/.env`) |
| Build do frontend | `cd frontend && npm run build` |

## Convenções
- Idioma da UI e dos docs: português brasileiro. Código e identificadores em inglês.
- Commits pequenos e descritivos, um por etapa ou subetapa.
- Toda lógica de negócio (parser, regras, semáforo, normalização de advisors) vai em `_shared/core` com testes.
- Toda tabela nova fica em `monitor.*` com RLS habilitado (o teste `tests/migrations.test.ts` garante).
- Nomes de métricas e endpoints: somente os confirmados na documentação oficial ou na saída real.

## Regras de segurança (inegociáveis)
1. **Projetos monitorados: somente leitura.** Apenas `GET` nos endpoints da allowlist em
   `_shared/core/readonly.ts` (Metrics API e advisors). Nenhum SQL, migração ou DDL neles.
2. **Projeto hospedeiro (ClaudeProjects):** escrita permitida **somente** em objetos do schema `monitor`,
   em Edge Functions `monitor-*`, em jobs `pg_cron` com prefixo `monitor-` e em segredos do Vault
   com prefixo `monitor_`. Nunca tocar `public`, `auth`, `storage` nem funções de outros apps.
   Aplicar migration/deploy só com OK explícito do Rodrigo.
3. Via MCP do Supabase: só ferramentas de leitura nos monitorados (`get_advisors`, `query_logs`, `list_*`, SELECT).
4. Segredos só em `.env` (ignorado pelo git), Vault ou secrets das Edge Functions. `.env.example` sem valores.
   Nunca imprimir segredos em logs, testes, respostas da API, frontend ou commits.
5. Sem comandos destrutivos (`rm -rf`, `git reset --hard`, `git push --force`, `DROP`) sem confirmação explícita.
6. Sem dependências novas fora da stack sem avisar o motivo.
7. Armazenar apenas métricas agregadas e metadados de achados, nunca dados de usuários finais (LGPD).
