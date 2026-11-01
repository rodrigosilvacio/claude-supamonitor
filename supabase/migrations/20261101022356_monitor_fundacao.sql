-- =============================================================================
-- Supabase Monitor: Etapa 1 (fundação)
-- Projeto hospedeiro: ClaudeProjects (compartilhado com outros apps).
-- REGRA: este arquivo só cria/altera objetos dentro do schema `monitor`.
-- Referências permitidas fora dele: auth.users (FK), auth.uid(), vault.*.
-- =============================================================================

create schema if not exists monitor;

-- Acesso ao schema: só usuários autenticados (RLS decide o resto) e service_role.
revoke all on schema monitor from public, anon;
grant usage on schema monitor to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Admins (allowlist). Só quem está aqui enxerga qualquer dado do monitor.
-- -----------------------------------------------------------------------------
create table monitor.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table monitor.admins enable row level security;

create or replace function monitor.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from monitor.admins a where a.user_id = auth.uid());
$$;
revoke all on function monitor.is_admin() from public, anon;
grant execute on function monitor.is_admin() to authenticated, service_role;

create policy admins_select_self on monitor.admins
  for select to authenticated
  using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- Projetos monitorados
-- -----------------------------------------------------------------------------
create table monitor.projects (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null check (char_length(name) between 1 and 120),
  project_ref          text not null unique check (project_ref ~ '^[a-z]{20}$'),
  environment          text not null default 'prod'
                       check (environment in ('prod', 'staging', 'dev', 'prototipo')),
  db_quota_bytes       bigint check (db_quota_bytes is null or db_quota_bytes > 0),
  max_connections      integer check (max_connections is null or max_connections > 0),
  active               boolean not null default true,
  secret_configured    boolean not null default false,
  consecutive_failures integer not null default 0,
  last_scrape_at       timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
alter table monitor.projects enable row level security;

create policy projects_admin_all on monitor.projects
  for all to authenticated
  using (monitor.is_admin())
  with check (monitor.is_admin());

grant select, insert, update, delete on monitor.projects to authenticated;
grant all on monitor.projects to service_role;

-- Mapeamento projeto -> segredo no Vault. Nenhum grant para authenticated.
create table monitor.project_secrets (
  project_id      uuid primary key references monitor.projects (id) on delete cascade,
  vault_secret_id uuid not null,
  updated_at      timestamptz not null default now()
);
alter table monitor.project_secrets enable row level security;
grant all on monitor.project_secrets to service_role;

-- -----------------------------------------------------------------------------
-- Auditoria (escrita só por trigger; admin apenas lê)
-- -----------------------------------------------------------------------------
create table monitor.audit_log (
  id         bigint generated always as identity primary key,
  action     text not null,
  entity     text not null,
  entity_id  text,
  project_id uuid,
  actor      uuid,
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table monitor.audit_log enable row level security;

create policy audit_admin_select on monitor.audit_log
  for select to authenticated
  using (monitor.is_admin());

grant select on monitor.audit_log to authenticated;
grant all on monitor.audit_log to service_role;

create or replace function monitor.tg_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row  jsonb;
  v_old  jsonb;
  v_id   text;
  v_proj uuid;
begin
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_old := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  v_id  := v_row ->> 'id';
  v_proj := case
    when tg_table_name = 'projects' then (v_row ->> 'id')::uuid
    else nullif(v_row ->> 'project_id', '')::uuid
  end;

  insert into monitor.audit_log (action, entity, entity_id, project_id, actor, details)
  values (
    lower(tg_op),
    tg_table_name,
    v_id,
    v_proj,
    auth.uid(),
    jsonb_build_object('new', case when tg_op = 'DELETE' then null else v_row end,
                       'old', case when tg_op = 'DELETE' then v_row else v_old end)
  );
  return null;
end;
$$;
revoke all on function monitor.tg_audit() from public, anon, authenticated;

create trigger projects_audit
  after insert or update or delete on monitor.projects
  for each row execute function monitor.tg_audit();

create or replace function monitor.tg_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger projects_touch
  before update on monitor.projects
  for each row execute function monitor.tg_touch_updated_at();

-- -----------------------------------------------------------------------------
-- Segredos dos projetos (Vault)
-- set_project_secret: admin grava/atualiza; o valor nunca volta ao frontend.
-- get_project_secret: somente service_role (Edge Functions).
-- -----------------------------------------------------------------------------
create or replace function monitor.set_project_secret(p_project_id uuid, p_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
begin
  if not monitor.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_secret is null or char_length(p_secret) < 20 then
    raise exception 'segredo inválido' using errcode = '22023';
  end if;
  if not exists (select 1 from monitor.projects where id = p_project_id) then
    raise exception 'projeto não encontrado' using errcode = 'P0002';
  end if;

  select vault_secret_id into v_secret_id
    from monitor.project_secrets where project_id = p_project_id;

  if v_secret_id is null then
    v_secret_id := vault.create_secret(
      p_secret,
      'monitor_project_' || p_project_id::text,
      'Secret API key (Metrics API) do projeto monitorado',
      null
    );
    insert into monitor.project_secrets (project_id, vault_secret_id)
    values (p_project_id, v_secret_id);
  else
    perform vault.update_secret(v_secret_id, p_secret, null, null, null);
    update monitor.project_secrets set updated_at = now() where project_id = p_project_id;
  end if;

  update monitor.projects set secret_configured = true where id = p_project_id;

  insert into monitor.audit_log (action, entity, entity_id, project_id, actor, details)
  values ('secret_set', 'project_secrets', p_project_id::text, p_project_id, auth.uid(), '{}'::jsonb);
end;
$$;
revoke all on function monitor.set_project_secret(uuid, text) from public, anon;
grant execute on function monitor.set_project_secret(uuid, text) to authenticated;

create or replace function monitor.get_project_secret(p_project_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select ds.decrypted_secret
    from monitor.project_secrets ps
    join vault.decrypted_secrets ds on ds.id = ps.vault_secret_id
   where ps.project_id = p_project_id;
$$;
revoke all on function monitor.get_project_secret(uuid) from public, anon, authenticated;
grant execute on function monitor.get_project_secret(uuid) to service_role;

-- Limpa o segredo do Vault quando o projeto é removido.
create or replace function monitor.tg_delete_project_secret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where id = old.vault_secret_id;
  return old;
end;
$$;
revoke all on function monitor.tg_delete_project_secret() from public, anon, authenticated;

create trigger project_secrets_cleanup
  after delete on monitor.project_secrets
  for each row execute function monitor.tg_delete_project_secret();

-- -----------------------------------------------------------------------------
-- Seed do admin único (usuário já existente no Auth do projeto).
-- -----------------------------------------------------------------------------
insert into monitor.admins (user_id)
select id from auth.users where lower(email) = 'rodrigosilvapmp@hotmail.com'
on conflict do nothing;
