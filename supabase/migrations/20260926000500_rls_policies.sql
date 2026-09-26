-- =============================================================================
-- Fase 1 — Row Level Security.
--
-- * Todas as tabelas do app têm RLS habilitado.
-- * anon/authenticated (Data API do Supabase) não têm privilégio algum: nenhuma
--   policy é criada para eles e os GRANTs são revogados explicitamente.
-- * As policies valem para app_user (backend com contexto de ator) e SEMPRE
--   restringem à organização ativa da transação (app.org_id), além de exigir
--   vínculo ativo do ator com essa organização.
-- =============================================================================

-- Ator atual (usuário ativo ou token de integração válido) pertence à org ativa.
create or replace function app.actor_in_current_org() returns boolean
language sql stable security definer set search_path = ''
as $$
  select case app.current_actor_type()
    when 'USER' then app.is_active_member(app.current_org_id())
    when 'INTEGRATION' then exists (
      select 1
      from public.integration_tokens t
      join public.organizations o on o.id = t.organization_id
      where t.id = app.current_integration_token_id()
        and t.organization_id = app.current_org_id()
        and t.revoked_at is null
        and (t.expires_at is null or t.expires_at > now())
        and o.status = 'active'
        and o.deleted_at is null
    )
    else false
  end
$$;

-- Identificador do ator para conferência em audit_logs.
create or replace function app.current_actor_id() returns uuid
language sql stable
as $$
  select case app.current_actor_type()
    when 'USER' then app.current_user_id()
    when 'INTEGRATION' then app.current_integration_token_id()
    else null
  end
$$;

grant execute on function app.actor_in_current_org(), app.current_actor_id() to app_user;

-- -----------------------------------------------------------------------------
-- Revogação explícita para roles do Data API (se existirem — Supabase).
-- -----------------------------------------------------------------------------
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
      execute format('revoke all on all functions in schema public from %I', r);
      execute format('revoke all on schema app from %I', r);
    end if;
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
-- Habilita RLS
-- -----------------------------------------------------------------------------
alter table public.organizations        enable row level security;
alter table public.permissions          enable row level security;
alter table public.roles                enable row level security;
alter table public.role_permissions     enable row level security;
alter table public.profiles             enable row level security;
alter table public.organization_members enable row level security;
alter table public.member_roles         enable row level security;
alter table public.integration_tokens   enable row level security;
alter table public.audit_logs           enable row level security;
alter table public.jobs                 enable row level security;
alter table public.outbox_events        enable row level security;
alter table public.idempotency_keys     enable row level security;
alter table public.rate_limit_buckets   enable row level security;

-- -----------------------------------------------------------------------------
-- GRANTs mínimos para app_user (RLS decide as linhas)
-- -----------------------------------------------------------------------------
grant select on public.organizations, public.permissions to app_user;
grant select, insert, update, delete on public.roles, public.role_permissions, public.member_roles to app_user;
grant select on public.profiles to app_user;
grant update (full_name, phone) on public.profiles to app_user;
grant select, insert on public.organization_members to app_user;
grant update (status, mfa_required) on public.organization_members to app_user;
grant select, insert on public.integration_tokens to app_user;
grant update (name, revoked_at, expires_at) on public.integration_tokens to app_user;
grant select, insert on public.audit_logs to app_user;
grant insert on public.jobs, public.outbox_events to app_user;
-- ON CONFLICT (idempotency_key) exige SELECT na coluna árbitro. Sem policy de
-- SELECT, nenhuma linha é visível para app_user mesmo assim.
grant select (idempotency_key) on public.jobs, public.outbox_events to app_user;
grant select, insert on public.idempotency_keys to app_user;
-- rate_limit_buckets: sem acesso para app_user (usado só pelo backend em contexto de sistema).

-- -----------------------------------------------------------------------------
-- organizations / permissions
-- -----------------------------------------------------------------------------
create policy organizations_select on public.organizations for select to app_user
  using (id = (select app.current_org_id()) and (select app.actor_in_current_org()));

create policy permissions_select on public.permissions for select to app_user
  using (true);

-- -----------------------------------------------------------------------------
-- roles / role_permissions: leitura por membros; escrita exige permissions.manage
-- -----------------------------------------------------------------------------
create policy roles_select on public.roles for select to app_user
  using (organization_id = (select app.current_org_id()) and (select app.actor_in_current_org()));
create policy roles_write on public.roles for all to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('permissions.manage')) and not is_system)
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('permissions.manage')) and not is_system);

create policy role_permissions_select on public.role_permissions for select to app_user
  using (organization_id = (select app.current_org_id()) and (select app.actor_in_current_org()));
create policy role_permissions_insert on public.role_permissions for insert to app_user
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('permissions.manage')));
create policy role_permissions_delete on public.role_permissions for delete to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('permissions.manage')));

create policy member_roles_select on public.member_roles for select to app_user
  using (
    organization_id = (select app.current_org_id())
    and (select app.actor_in_current_org())
    and (
      (select app.has_permission('users.read'))
      or member_id in (select m.id from public.organization_members m where m.user_id = (select app.current_user_id()))
    )
  );
-- Atribuir role é potencial escalonamento de privilégio: exige permissions.manage.
create policy member_roles_insert on public.member_roles for insert to app_user
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('permissions.manage')));
create policy member_roles_delete on public.member_roles for delete to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('permissions.manage')));

-- -----------------------------------------------------------------------------
-- profiles / organization_members
-- -----------------------------------------------------------------------------
create policy profiles_select on public.profiles for select to app_user
  using (
    id = (select app.current_user_id())
    or (
      (select app.has_permission('users.read'))
      and exists (
        select 1 from public.organization_members m
        where m.user_id = profiles.id and m.organization_id = (select app.current_org_id())
      )
    )
  );
create policy profiles_update_own on public.profiles for update to app_user
  using (id = (select app.current_user_id()))
  with check (id = (select app.current_user_id()));

-- O próprio vínculo é visível em qualquer org (necessário para montar o ator);
-- vínculos de terceiros só com users.read na org ativa.
create policy organization_members_select on public.organization_members for select to app_user
  using (
    user_id = (select app.current_user_id())
    or (organization_id = (select app.current_org_id()) and (select app.has_permission('users.read')))
  );
create policy organization_members_insert on public.organization_members for insert to app_user
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('users.manage')));
create policy organization_members_update on public.organization_members for update to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('users.manage')))
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('users.manage')));

-- -----------------------------------------------------------------------------
-- integration_tokens
-- -----------------------------------------------------------------------------
create policy integration_tokens_select on public.integration_tokens for select to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('integrations.manage')));
create policy integration_tokens_insert on public.integration_tokens for insert to app_user
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('integrations.manage')));
create policy integration_tokens_update on public.integration_tokens for update to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('integrations.manage')))
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('integrations.manage')));

-- -----------------------------------------------------------------------------
-- audit_logs: leitura com audit.read; inserção apenas do próprio ator na org ativa.
-- -----------------------------------------------------------------------------
create policy audit_logs_select on public.audit_logs for select to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('audit.read')));
create policy audit_logs_insert on public.audit_logs for insert to app_user
  with check (
    organization_id = (select app.current_org_id())
    and (select app.actor_in_current_org())
    and actor_type = (select app.current_actor_type())
    and actor_id = (select app.current_actor_id())
  );

-- -----------------------------------------------------------------------------
-- jobs / outbox / idempotency: operações enfileiram na própria org.
-- -----------------------------------------------------------------------------
create policy jobs_insert on public.jobs for insert to app_user
  with check (organization_id = (select app.current_org_id()) and (select app.actor_in_current_org()));
-- INSERT ... ON CONFLICT exige que a linha passe numa policy de SELECT. O GRANT
-- é só da coluna idempotency_key, então nada além dela é legível.
create policy jobs_select_conflict on public.jobs for select to app_user
  using (organization_id = (select app.current_org_id()) and (select app.actor_in_current_org()));

create policy outbox_events_insert on public.outbox_events for insert to app_user
  with check (organization_id = (select app.current_org_id()) and (select app.actor_in_current_org()));
create policy outbox_events_select_conflict on public.outbox_events for select to app_user
  using (organization_id = (select app.current_org_id()) and (select app.actor_in_current_org()));

create policy idempotency_keys_select on public.idempotency_keys for select to app_user
  using (organization_id = (select app.current_org_id()) and (select app.actor_in_current_org()));
create policy idempotency_keys_insert on public.idempotency_keys for insert to app_user
  with check (organization_id = (select app.current_org_id()) and (select app.actor_in_current_org()));

-- -----------------------------------------------------------------------------
-- Funções do schema app: ninguém executa por padrão; app_user só o necessário
-- para as policies. Funções administrativas (bootstrap, claim, rate limit)
-- ficam restritas ao role de login do backend.
-- -----------------------------------------------------------------------------
revoke all on all functions in schema app from public;
grant execute on function
  app.current_user_id(),
  app.current_org_id(),
  app.current_actor_type(),
  app.current_integration_token_id(),
  app.current_actor_id(),
  app.is_active_member(uuid),
  app.current_permissions(),
  app.has_permission(text),
  app.actor_in_current_org()
to app_user;
