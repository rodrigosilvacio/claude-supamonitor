-- =============================================================================
-- Supabase Monitor: Etapa 2 (advisors)
-- REGRA: só objetos no schema `monitor`, job pg_cron `monitor-*`, segredo Vault `monitor_*`.
-- =============================================================================

-- Achados de advisors (segurança e performance) por projeto monitorado.
create table monitor.advisor_findings (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references monitor.projects (id) on delete cascade,
  category        text not null check (category in ('security', 'performance')),
  lint_name       text not null,
  title           text not null,
  level           text not null check (level in ('ERROR', 'WARN', 'INFO')),
  facing          text,
  detail          text not null default '',
  remediation_url text check (remediation_url is null or remediation_url ~* '^https://'),
  metadata        jsonb not null default '{}'::jsonb,
  fingerprint     text not null,
  status          text not null default 'open' check (status in ('open', 'resolved')),
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  resolved_at     timestamptz,
  unique (project_id, fingerprint)
);
create index advisor_findings_project_status_idx on monitor.advisor_findings (project_id, status);
alter table monitor.advisor_findings enable row level security;

create policy findings_admin_select on monitor.advisor_findings
  for select to authenticated
  using (monitor.is_admin());

grant select on monitor.advisor_findings to authenticated;
grant all on monitor.advisor_findings to service_role;

-- Execuções de coleta (rastreabilidade e indicador "coletas em dia").
create table monitor.collection_runs (
  id          bigint generated always as identity primary key,
  project_id  uuid references monitor.projects (id) on delete cascade,
  kind        text not null check (kind in ('advisors_security', 'advisors_performance', 'metrics')),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean not null,
  http_status integer,
  message     text,
  items       integer,
  details     jsonb not null default '{}'::jsonb
);
create index collection_runs_project_kind_idx on monitor.collection_runs (project_id, kind, started_at desc);
alter table monitor.collection_runs enable row level security;

create policy runs_admin_select on monitor.collection_runs
  for select to authenticated
  using (monitor.is_admin());

grant select on monitor.collection_runs to authenticated;
grant all on monitor.collection_runs to service_role;

-- -----------------------------------------------------------------------------
-- Segredo compartilhado entre pg_cron e as Edge Functions de coleta.
-- Gerado aqui, guardado no Vault; nunca sai do banco (a função valida via RPC).
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'monitor_cron_secret') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'monitor_cron_secret',
      'Autentica chamadas do pg_cron às Edge Functions monitor-*',
      null
    );
  end if;
end;
$$;

create or replace function monitor.verify_cron_secret(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select ds.decrypted_secret = p_secret
       from vault.decrypted_secrets ds
      where ds.name = 'monitor_cron_secret'),
    false
  );
$$;
revoke all on function monitor.verify_cron_secret(text) from public, anon, authenticated;
grant execute on function monitor.verify_cron_secret(text) to service_role;

-- Dispara uma Edge Function monitor-* via pg_net (chamado pelo pg_cron).
create or replace function monitor.invoke_function(p_fn text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_request_id bigint;
begin
  if p_fn !~ '^monitor-[a-z-]+$' then
    raise exception 'função não permitida: %', p_fn;
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'monitor_cron_secret';
  select net.http_post(
    url := 'https://xtrvojnauvkkterogrst.supabase.co/functions/v1/' || p_fn,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-monitor-cron-secret', v_secret),
    timeout_milliseconds := 120000
  ) into v_request_id;
  return v_request_id;
end;
$$;
revoke all on function monitor.invoke_function(text) from public, anon, authenticated;

-- Advisors a cada 6 h (minuto 17 para fugir do pico do minuto 0).
select cron.schedule(
  'monitor-collect-advisors',
  '17 */6 * * *',
  $cron$ select monitor.invoke_function('monitor-collect-advisors'); $cron$
);
