-- =============================================================================
-- Fase 1 — Fundação: schema privado, roles de banco e funções utilitárias.
--
-- Modelo de acesso ao banco (ver docs/DATABASE.md e docs/SECURITY.md):
--   * O navegador NUNCA acessa tabelas diretamente. anon/authenticated (roles
--     do PostgREST/Supabase) não recebem privilégio algum nas tabelas do app.
--   * O backend conecta com o role de login (postgres/Supavisor) e, para
--     operações em nome de um usuário ou integração, executa
--     `SET LOCAL ROLE app_user` + `set_config('app.*')` dentro da transação.
--     Assim o RLS é aplicado também ao backend (defesa em profundidade).
--   * Operações de sistema (worker, webhooks) rodam com o role de login, dono
--     das tabelas, e são sempre explícitas no código (withSystemTransaction).
-- =============================================================================

create extension if not exists pgcrypto;

create schema if not exists app;
comment on schema app is 'Funções privadas do Toalhas Express. Não expor no PostgREST.';

-- Role assumido pelo backend para operações com contexto de usuário (RLS ativo).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user nologin noinherit;
  end if;
end
$$;

-- O role de login atual (dono das migrations) precisa poder assumir app_user.
do $$
begin
  execute format('grant app_user to %I', current_user);
end
$$;

grant usage on schema app to app_user;
grant usage on schema public to app_user;

-- Supabase concede, por padrão, ALL em novas tabelas/funções de public para
-- anon/authenticated. Revogamos esse padrão: o Data API não é usado pelo app.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'alter default privileges in schema public revoke all on tables from anon';
    execute 'alter default privileges in schema public revoke all on sequences from anon';
    execute 'alter default privileges in schema public revoke all on functions from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'alter default privileges in schema public revoke all on tables from authenticated';
    execute 'alter default privileges in schema public revoke all on sequences from authenticated';
    execute 'alter default privileges in schema public revoke all on functions from authenticated';
  end if;
end
$$;

revoke all on schema app from public;
-- Default global (não por schema: default por schema só adiciona privilégios).
-- Toda função nova nasce sem EXECUTE para PUBLIC; conceda explicitamente.
alter default privileges revoke execute on functions from public;

-- -----------------------------------------------------------------------------
-- Contexto da requisição (preenchido pelo backend via set_config, escopo local
-- à transação). Leitura tolerante: ausência = null.
-- -----------------------------------------------------------------------------
create or replace function app.current_user_id() returns uuid
language sql stable
as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

create or replace function app.current_org_id() returns uuid
language sql stable
as $$ select nullif(current_setting('app.org_id', true), '')::uuid $$;

create or replace function app.current_actor_type() returns text
language sql stable
as $$ select nullif(current_setting('app.actor_type', true), '') $$;

create or replace function app.current_integration_token_id() returns uuid
language sql stable
as $$ select nullif(current_setting('app.integration_token_id', true), '')::uuid $$;

-- -----------------------------------------------------------------------------
-- Triggers utilitários
-- -----------------------------------------------------------------------------
create or replace function app.set_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- Tabelas append-only (ledgers, audit logs, eventos brutos): nada de UPDATE,
-- DELETE ou TRUNCATE. Correções são novos registros.
create or replace function app.prevent_mutation() returns trigger
language plpgsql
as $$
begin
  raise exception 'Tabela % é append-only: % não permitido', tg_table_name, tg_op
    using errcode = 'P0001', hint = 'Registre um novo movimento/evento de correção.';
end
$$;

grant execute on function
  app.current_user_id(),
  app.current_org_id(),
  app.current_actor_type(),
  app.current_integration_token_id()
to app_user;
