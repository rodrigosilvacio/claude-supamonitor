-- =============================================================================
-- Supabase Monitor: Etapa 3 (métricas)
-- REGRA: só objetos no schema `monitor` e job pg_cron `monitor-*`.
-- =============================================================================

-- Snapshot por minuto por projeto (somente agregados; nada de dados de usuários finais).
create table monitor.metric_snapshots (
  id                   bigint generated always as identity primary key,
  project_id           uuid not null references monitor.projects (id) on delete cascade,
  collected_at         timestamptz not null default now(),
  scrape_ok            boolean not null,
  error                text,
  connections_used     integer,
  connections_max      integer,
  connections_used_pct numeric(6, 2),
  cpu_pct              numeric(6, 2),
  mem_used_pct         numeric(6, 2),
  db_size_bytes        bigint,
  disk_used_pct        numeric(6, 2),
  replication_lag_s    numeric(12, 3),
  pooler_connections   integer,
  raw_subset           jsonb not null default '{}'::jsonb
);
create index metric_snapshots_project_time_idx on monitor.metric_snapshots (project_id, collected_at desc);
alter table monitor.metric_snapshots enable row level security;

create policy snapshots_admin_select on monitor.metric_snapshots
  for select to authenticated
  using (monitor.is_admin());

grant select on monitor.metric_snapshots to authenticated;
grant all on monitor.metric_snapshots to service_role;

-- Catálogo das métricas expostas por projeto (nomes/labels, sem valores): base do teste de contrato.
create table monitor.metric_catalog (
  project_id    uuid not null references monitor.projects (id) on delete cascade,
  metric_name   text not null,
  type          text,
  label_keys    text[] not null default '{}',
  sample_labels jsonb not null default '{}'::jsonb,
  series        integer not null default 0,
  last_seen_at  timestamptz not null default now(),
  primary key (project_id, metric_name)
);
alter table monitor.metric_catalog enable row level security;

create policy catalog_admin_select on monitor.metric_catalog
  for select to authenticated
  using (monitor.is_admin());

grant select on monitor.metric_catalog to authenticated;
grant all on monitor.metric_catalog to service_role;

-- Série agregada para gráficos (evita o limite de linhas da API em 7 dias).
-- security invoker: o RLS de metric_snapshots continua valendo.
create or replace function monitor.metric_series(p_project_id uuid, p_hours integer, p_bucket_minutes integer)
returns table (
  bucket               timestamptz,
  connections_used_pct numeric,
  cpu_pct              numeric,
  mem_used_pct         numeric,
  db_size_bytes        bigint,
  disk_used_pct        numeric,
  replication_lag_s    numeric,
  scrapes              integer,
  scrapes_ok           integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    date_bin(make_interval(mins => greatest(1, least(p_bucket_minutes, 1440))), s.collected_at, timestamptz '2000-01-01') as bucket,
    round(avg(s.connections_used_pct), 2),
    round(avg(s.cpu_pct), 2),
    round(avg(s.mem_used_pct), 2),
    max(s.db_size_bytes),
    round(avg(s.disk_used_pct), 2),
    round(max(s.replication_lag_s), 3),
    count(*)::integer,
    count(*) filter (where s.scrape_ok)::integer
  from monitor.metric_snapshots s
  where s.project_id = p_project_id
    and s.collected_at >= now() - make_interval(hours => greatest(1, least(p_hours, 720)))
  group by 1
  order by 1;
$$;
revoke all on function monitor.metric_series(uuid, integer, integer) from public, anon;
grant execute on function monitor.metric_series(uuid, integer, integer) to authenticated;

-- Incremento atômico do contador de falhas consecutivas (base do alerta "fora do ar").
create or replace function monitor.mark_scrape(p_project_id uuid, p_ok boolean, p_at timestamptz)
returns integer
language sql
security definer
set search_path = ''
as $$
  update monitor.projects
     set consecutive_failures = case when p_ok then 0 else consecutive_failures + 1 end,
         last_scrape_at = p_at
   where id = p_project_id
  returning consecutive_failures;
$$;
revoke all on function monitor.mark_scrape(uuid, boolean, timestamptz) from public, anon, authenticated;
grant execute on function monitor.mark_scrape(uuid, boolean, timestamptz) to service_role;

-- Scrape a cada 1 minuto.
select cron.schedule(
  'monitor-collect-metrics',
  '* * * * *',
  $cron$ select monitor.invoke_function('monitor-collect-metrics'); $cron$
);
