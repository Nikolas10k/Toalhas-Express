-- =============================================================================
-- Fase 1 — Organizações, perfis, RBAC com permissões granulares e tokens de
-- integração. A autorização SEMPRE valida permissão, nunca nome de role.
-- =============================================================================

create table public.organizations (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (length(btrim(name)) between 2 and 200),
  slug            text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'),
  legal_name      text,
  document        text check (document is null or document ~ '^[0-9]{11}$|^[0-9]{14}$'),
  timezone        text not null default 'America/Sao_Paulo',
  status          text not null default 'active' check (status in ('active', 'suspended', 'inactive')),
  settings        jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index organizations_status_idx on public.organizations (status);
create trigger organizations_set_updated_at before update on public.organizations
  for each row execute function app.set_updated_at();

-- Catálogo global de permissões (dado de referência, igual em todos os ambientes).
create table public.permissions (
  code              text primary key check (code ~ '^[a-z_]+\.[a-z_]+$'),
  category          text not null,
  description       text not null,
  requires_step_up  boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger permissions_set_updated_at before update on public.permissions
  for each row execute function app.set_updated_at();

insert into public.permissions (code, category, description, requires_step_up) values
  ('admin.access',                    'admin',        'Acessar o painel administrativo', false),
  ('organization.read',               'admin',        'Ver dados da organização', false),
  ('organization.manage',             'admin',        'Alterar configurações da organização', true),
  ('users.read',                      'admin',        'Ver usuários da organização', false),
  ('users.manage',                    'admin',        'Convidar, suspender e alterar usuários', true),
  ('permissions.manage',              'admin',        'Alterar roles e permissões', true),
  ('integrations.manage',             'admin',        'Gerenciar integrações e tokens de API', true),
  ('automations.manage',              'admin',        'Ligar/desligar automações', false),
  ('audit.read',                      'admin',        'Ver trilha de auditoria', false),
  ('customer.read',                   'customers',    'Ver clientes', false),
  ('customer.create',                 'customers',    'Cadastrar clientes', false),
  ('customer.update',                 'customers',    'Alterar clientes', false),
  ('customer.approve',                'customers',    'Aprovar auto cadastro de clientes', false),
  ('customer.import',                 'customers',    'Importar clientes via CSV', false),
  ('customer.export',                 'customers',    'Exportar dados de clientes em massa', true),
  ('customer.anonymize',              'customers',    'Anonimizar dados pessoais (LGPD)', true),
  ('product.read',                    'inventory',    'Ver produtos', false),
  ('product.manage',                  'inventory',    'Cadastrar e alterar produtos', false),
  ('inventory.read',                  'inventory',    'Ver estoque e movimentações', false),
  ('inventory.move',                  'inventory',    'Registrar movimentos operacionais de estoque', false),
  ('inventory.adjust',                'inventory',    'Ajuste manual de estoque/saldo', false),
  ('inventory.adjust_large',          'inventory',    'Ajuste grande de estoque (acima do limite)', true),
  ('laundry.read',                    'inventory',    'Ver lavanderia', false),
  ('laundry.manage',                  'inventory',    'Operar lotes de lavanderia', false),
  ('order.read',                      'orders',       'Ver pedidos', false),
  ('order.create',                    'orders',       'Criar pedidos', false),
  ('order.create_draft',              'orders',       'Criar pedidos em rascunho (integração)', false),
  ('order.update',                    'orders',       'Alterar pedidos e transições de status', false),
  ('order.cancel',                    'orders',       'Cancelar pedidos', false),
  ('order.override_stock',            'orders',       'Confirmar pedido com estoque insuficiente', true),
  ('route.read',                      'routes',       'Ver rotas', false),
  ('route.manage',                    'routes',       'Planejar e alterar rotas', false),
  ('driver.manage',                   'routes',       'Gerenciar motoristas', false),
  ('vehicle.manage',                  'routes',       'Gerenciar veículos', false),
  ('driver_app.access',               'routes',       'Acessar o app do motorista (somente rotas próprias)', false),
  ('operation.execute',               'operations',   'Registrar entrega, coleta e prova', false),
  ('incident.read',                   'operations',   'Ver ocorrências', false),
  ('incident.report',                 'operations',   'Registrar ocorrências', false),
  ('incident.manage',                 'operations',   'Analisar e resolver ocorrências', false),
  ('contract.read',                   'contracts',    'Ver contratos', false),
  ('contract.manage',                 'contracts',    'Criar e alterar contratos', false),
  ('finance.read',                    'finance',      'Ver financeiro', false),
  ('finance.create_charge',           'finance',      'Criar cobranças', false),
  ('finance.cancel_charge',           'finance',      'Cancelar cobranças', true),
  ('finance.register_manual_payment', 'finance',      'Registrar pagamento manual', true),
  ('finance.refund',                  'finance',      'Estornar pagamentos', true),
  ('finance.reconcile',               'finance',      'Conciliar pagamentos', false),
  ('reports.read',                    'reports',      'Ver relatórios e dashboards', false),
  ('reports.export',                  'reports',      'Exportar relatórios em massa', true),
  ('notifications.manage',            'integrations', 'Gerenciar notificações', false),
  ('notifications.callback',          'integrations', 'Informar status de mensagens (integração)', false),
  ('jobs.run',                        'integrations', 'Disparar worker e rotinas agendadas', false),
  ('portal.access',                   'portal',       'Acessar o portal do cliente (somente dados próprios)', false);

create table public.roles (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete restrict,
  code             text not null check (code ~ '^[A-Z][A-Z0-9_]{1,49}$'),
  name             text not null,
  description      text,
  is_system        boolean not null default false,
  -- Membros com este role só acessam áreas internas após verificar TOTP (AAL2).
  mfa_required     boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, code),
  unique (organization_id, id)
);
create index roles_organization_id_idx on public.roles (organization_id);
create trigger roles_set_updated_at before update on public.roles
  for each row execute function app.set_updated_at();

create table public.role_permissions (
  organization_id  uuid not null,
  role_id          uuid not null,
  permission_code  text not null references public.permissions (code) on delete restrict,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (role_id, permission_code),
  foreign key (organization_id, role_id) references public.roles (organization_id, id) on delete cascade
);
create index role_permissions_organization_id_idx on public.role_permissions (organization_id);
create index role_permissions_permission_code_idx on public.role_permissions (permission_code);
create trigger role_permissions_set_updated_at before update on public.role_permissions
  for each row execute function app.set_updated_at();

-- Perfil global do usuário (1:1 com auth.users). Dados mínimos (LGPD).
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete restrict,
  full_name   text check (full_name is null or length(full_name) <= 200),
  phone       text check (phone is null or phone ~ '^\+55[0-9]{10,11}$'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  anonymized_at timestamptz
);
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function app.set_updated_at();

create table public.organization_members (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete restrict,
  user_id          uuid not null references public.profiles (id) on delete restrict,
  status           text not null default 'active' check (status in ('invited', 'active', 'suspended', 'removed')),
  mfa_required     boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, user_id),
  unique (organization_id, id)
);
create index organization_members_user_id_idx on public.organization_members (user_id);
create index organization_members_status_idx on public.organization_members (organization_id, status);
create trigger organization_members_set_updated_at before update on public.organization_members
  for each row execute function app.set_updated_at();

create table public.member_roles (
  organization_id  uuid not null,
  member_id        uuid not null,
  role_id          uuid not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (member_id, role_id),
  foreign key (organization_id, member_id) references public.organization_members (organization_id, id) on delete cascade,
  foreign key (organization_id, role_id) references public.roles (organization_id, id) on delete restrict
);
create index member_roles_organization_id_idx on public.member_roles (organization_id);
create index member_roles_role_id_idx on public.member_roles (role_id);
create trigger member_roles_set_updated_at before update on public.member_roles
  for each row execute function app.set_updated_at();

-- Tokens de API para o perfil INTEGRATION (n8n). Só o hash SHA-256 é gravado.
create table public.integration_tokens (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete restrict,
  role_id          uuid not null,
  name             text not null check (length(btrim(name)) between 2 and 100),
  token_prefix     text not null check (token_prefix ~ '^[a-z0-9]{8}$'),
  token_hash       text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by       uuid references public.profiles (id) on delete restrict,
  last_used_at     timestamptz,
  expires_at       timestamptz,
  revoked_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (token_prefix),
  foreign key (organization_id, role_id) references public.roles (organization_id, id) on delete restrict
);
create index integration_tokens_organization_id_idx on public.integration_tokens (organization_id);
create index integration_tokens_role_id_idx on public.integration_tokens (role_id);
create trigger integration_tokens_set_updated_at before update on public.integration_tokens
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Funções de autorização usadas pelas políticas RLS. SECURITY DEFINER para
-- evitar recursão de RLS; search_path fixo contra hijacking.
-- -----------------------------------------------------------------------------
create or replace function app.is_active_member(p_org uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = p_org
      and m.user_id = app.current_user_id()
      and m.status = 'active'
      and o.status = 'active'
      and o.deleted_at is null
  )
$$;

-- Permissões efetivas do ator atual (usuário ou token de integração) na
-- organização ativa da transação.
create or replace function app.current_permissions() returns text[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(distinct rp.permission_code), '{}')
  from (
    select mr.role_id
    from public.organization_members m
    join public.member_roles mr on mr.member_id = m.id and mr.organization_id = m.organization_id
    join public.organizations o on o.id = m.organization_id
    where app.current_actor_type() = 'USER'
      and m.organization_id = app.current_org_id()
      and m.user_id = app.current_user_id()
      and m.status = 'active'
      and o.status = 'active'
      and o.deleted_at is null
    union all
    select t.role_id
    from public.integration_tokens t
    join public.organizations o on o.id = t.organization_id
    where app.current_actor_type() = 'INTEGRATION'
      and t.id = app.current_integration_token_id()
      and t.organization_id = app.current_org_id()
      and t.revoked_at is null
      and (t.expires_at is null or t.expires_at > now())
      and o.status = 'active'
      and o.deleted_at is null
  ) r
  join public.role_permissions rp on rp.role_id = r.role_id
$$;

create or replace function app.has_permission(p_permission text) returns boolean
language sql stable security definer set search_path = ''
as $$ select p_permission = any (app.current_permissions()) $$;

grant execute on function app.is_active_member(uuid), app.current_permissions(), app.has_permission(text) to app_user;

-- -----------------------------------------------------------------------------
-- Bootstrap de organização: cria roles de sistema com permissões padrão.
-- Chamado apenas por scripts administrativos/seed (role de login), nunca pelo app_user.
-- -----------------------------------------------------------------------------
create or replace function app.bootstrap_organization(p_name text, p_slug text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_org uuid;
  v_role uuid;
begin
  insert into public.organizations (name, slug) values (p_name, p_slug) returning id into v_org;

  -- ADMIN: todas as permissões.
  insert into public.roles (organization_id, code, name, description, is_system, mfa_required)
  values (v_org, 'ADMIN', 'Administrador', 'Acesso total. MFA obrigatório.', true, true) returning id into v_role;
  insert into public.role_permissions (organization_id, role_id, permission_code)
  select v_org, v_role, code from public.permissions;

  -- MANAGER: operação completa; financeiro sensível só se atribuído depois.
  insert into public.roles (organization_id, code, name, description, is_system)
  values (v_org, 'MANAGER', 'Gerente', 'Operação completa. Financeiro conforme permissões atribuídas.', true) returning id into v_role;
  insert into public.role_permissions (organization_id, role_id, permission_code)
  select v_org, v_role, code from public.permissions
  where code not in (
    'organization.manage', 'users.manage', 'permissions.manage', 'integrations.manage',
    'customer.anonymize', 'finance.cancel_charge', 'finance.register_manual_payment',
    'finance.refund', 'finance.reconcile', 'order.create_draft', 'notifications.callback',
    'jobs.run', 'portal.access', 'driver_app.access', 'inventory.adjust_large', 'order.override_stock'
  );

  -- DRIVER: apenas app do motorista; nada financeiro.
  insert into public.roles (organization_id, code, name, description, is_system)
  values (v_org, 'DRIVER', 'Motorista', 'Somente as próprias rotas. Sem acesso financeiro.', true) returning id into v_role;
  insert into public.role_permissions (organization_id, role_id, permission_code)
  select v_org, v_role, code from public.permissions
  where code in ('driver_app.access', 'operation.execute', 'incident.report');

  -- CUSTOMER: somente dados próprios via portal.
  insert into public.roles (organization_id, code, name, description, is_system)
  values (v_org, 'CUSTOMER', 'Cliente', 'Portal do cliente: somente dados próprios.', true) returning id into v_role;
  insert into public.role_permissions (organization_id, role_id, permission_code)
  select v_org, v_role, code from public.permissions where code in ('portal.access');

  -- INTEGRATION: n8n, permissões mínimas.
  insert into public.roles (organization_id, code, name, description, is_system)
  values (v_org, 'INTEGRATION', 'Integração', 'Token de API para o n8n. Permissões mínimas.', true) returning id into v_role;
  insert into public.role_permissions (organization_id, role_id, permission_code)
  select v_org, v_role, code from public.permissions
  where code in ('order.create_draft', 'jobs.run', 'notifications.callback');

  return v_org;
end
$$;
revoke all on function app.bootstrap_organization(text, text) from public;
