# Supabase Monitor

Painel único de saúde, segurança e alertas para vários projetos Supabase.
Frontend no **GitHub Pages**, backend no **Supabase** (schema `monitor` do projeto ClaudeProjects).

> Status: **Etapa 2 (advisors)**: coleta de advisors a cada 6 h (pg_cron) e página Segurança com KPIs, farol, tendência e achados agrupados.

## Como rodar
```bash
npm install && npm test                 # testes do núcleo
cd frontend && cp .env.example .env      # preencha URL e publishable key
npm install && npm run dev
```

## Setup do backend (uma vez)
1. Aplicar `supabase/migrations/*.sql` no projeto hospedeiro.
2. Em **Project Settings > Data API > Exposed schemas**, incluir `monitor`.
3. Deploy das Edge Functions `monitor-test-connection` (verify_jwt on) e `monitor-collect-advisors` (verify_jwt off, autenticação própria: segredo do pg_cron no Vault ou JWT de admin). Secret: `MONITOR_SUPABASE_PAT` (permissão Advisors: Read).
4. No GitHub: **Settings > Pages > Source = GitHub Actions** e variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`.

Veja `CLAUDE.md` (regras) e `docs/arquitetura.md` (decisões).
