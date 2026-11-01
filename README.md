# Supabase Monitor

Painel único de saúde, segurança e alertas para vários projetos Supabase.
Frontend no **GitHub Pages**, backend no **Supabase** (schema `monitor` do projeto ClaudeProjects).

> Status: **Etapa 1 (fundação)**: login, cadastro de projetos com chave no Vault, auditoria e teste de conexão.

## Como rodar
```bash
npm install && npm test                 # testes do núcleo
cd frontend && cp .env.example .env      # preencha URL e publishable key
npm install && npm run dev
```

## Setup do backend (uma vez)
1. Aplicar `supabase/migrations/*.sql` no projeto hospedeiro.
2. Em **Project Settings > Data API > Exposed schemas**, incluir `monitor`.
3. Deploy da Edge Function `monitor-test-connection` e secrets: `MONITOR_SUPABASE_PAT` (e `MONITOR_ALLOWED_ORIGIN`).
4. No GitHub: **Settings > Pages > Source = GitHub Actions** e variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`.

Veja `CLAUDE.md` (regras) e `docs/arquitetura.md` (decisões).
