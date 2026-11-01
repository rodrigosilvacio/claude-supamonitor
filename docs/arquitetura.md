# Arquitetura e decisões (ADR resumido)

## ADR-001: Frontend estático no GitHub Pages + Supabase como backend
- **Contexto**: o painel será acessado pelo GitHub Pages (somente arquivos estáticos).
- **Decisão**: coleta, regras, segredos e dados ficam no Supabase (Edge Functions, pg_cron, Vault, Postgres);
  o Pages só serve o React. Alternativas descartadas: GitHub Actions como coletor (cron mínimo de 5 min, sem 1 min
  confiável) e FastAPI hospedado (infra extra e cookies entre domínios).
- **Consequência**: stack TypeScript de ponta a ponta; Python saiu do escopo.

## ADR-002: Hospedar no ClaudeProjects, em schema isolado
- **Contexto**: o Rodrigo optou por usar o projeto existente ClaudeProjects, que também é o primeiro projeto monitorado.
  O projeto é compartilhado (outros apps e usuários no Auth).
- **Decisão**: schema `monitor`, Edge Functions `monitor-*`, allowlist `monitor.admins`, RLS em todas as tabelas.
- **Consequência**: o schema `monitor` precisa ser incluído em *Exposed schemas* da Data API.
  Risco: se o ClaudeProjects cair, o monitor cai junto (mitigação: heartbeat via GitHub Actions na etapa 6).

## ADR-003: Endpoints oficiais (confirmados na documentação)
| Fonte | Endpoint | Auth |
|---|---|---|
| Metrics API (beta) | `GET https://<ref>.supabase.co/customer/v1/privileged/metrics` | Basic `service_role:<sb_secret_...>` |
| Advisors (experimental) | `GET https://api.supabase.com/v1/projects/{ref}/advisors/security` e `/performance` | `Bearer <PAT>` |
| Agendamento | `pg_cron` + `pg_net` chamando Edge Functions (guia "Scheduling Edge Functions") | segredo no Vault |

## Métricas candidatas (dashboard oficial supabase-grafana; validar na saída real na etapa 3)
| Indicador | Série |
|---|---|
| Banco no ar | `pg_up` |
| Conexões | `pg_stat_database_num_backends` (soma) ÷ `max_connections` (métrica, se existir, ou cadastro) |
| Tamanho do banco | `pg_database_size_mb` |
| CPU % | `node_cpu_seconds_total{mode="idle"}` (delta entre scrapes) |
| Disco % | `node_filesystem_size_bytes` / `node_filesystem_avail_bytes` (`/data`) |
| Lag de replicação | `physical_replication_lag_physical_replication_lag_seconds` (só com réplica) |
| Pooler | `supavisor_connections_active` |

## ADR-004: Formato real da resposta de advisors (validado em 01/11/2026)
- A REST API (`/v1/projects/{ref}/advisors/*`) devolve **um item por achado, com `cache_key`** (formato "plano").
  Todos os 243 achados do ClaudeProjects receberam fingerprint `ck:<cache_key>`.
- O MCP `get_advisors` devolve o formato agrupado (`findings[]`); o normalizador aceita os dois.
- Coleta ponta a ponta validada: pg_cron/pg_net → Edge Function → Management API (token escopado Advisors: Read) → `monitor.advisor_findings`.

## ADR-005: Mapeamento real da Metrics API (validado em 01/11/2026, 305 métricas)
| Indicador | Série real | Observação |
|---|---|---|
| Conexões usadas | `pg_stat_database_num_backends` (1 série, label `server`) | |
| Máx. conexões | `max_connections_connection_count` (exporter Supabase) | `pg_settings_max_connections` **não** é exposto; cadastro como fallback |
| CPU % | `node_cpu_seconds_total` (16 séries) | o endpoint repete contadores entre scrapes: repete-se o último valor |
| Memória % | `node_memory_MemTotal_bytes` / `MemAvailable_bytes` | |
| Disco % | `node_filesystem_size_bytes` / `avail_bytes` | só mountpoint `/` neste projeto (fallback já previsto) |
| Tamanho do banco | `pg_database_size_bytes` (soma por `datname`) | |
| Lag de replicação | `physical_replication_lag_physical_replication_lag_seconds` | exposto mesmo sem réplica (valor 0) |
| Pooler | `pgbouncer_pools_client_active_connections` | `supavisor_*` não exposto |
Contrato: `tests/metrics-contract.test.ts` + `tests/fixtures/metrics_catalog_real.json`.
