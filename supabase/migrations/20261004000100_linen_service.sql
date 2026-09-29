-- =============================================================================
-- Fase 8B — Higienização de enxoval de clientes (hotéis/spas) e perfil Operador.
--
-- Enxoval do cliente (produto kind = 'LINEN') não é estoque da empresa: nunca
-- entra no ledger de toalhas. O ciclo fica na Ordem de Serviço (OS-00001):
-- COLLECTED (coletado com rol) → READY (lavado, conferido) → DELIVERED.
-- =============================================================================

alter table public.products
  add column kind text not null default 'RENTAL' check (kind in ('RENTAL', 'LINEN'));
create index products_org_kind_idx on public.products (organization_id, kind);

-- Garantia no banco: enxoval de cliente nunca gera movimento de estoque.
create or replace function app.towel_movement_rental_only() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if exists (select 1 from public.products p where p.id = new.product_id and p.kind <> 'RENTAL') then
    raise exception 'Enxoval de cliente não movimenta o estoque de toalhas' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger towel_movements_rental_only before insert on public.towel_movements
  for each row execute function app.towel_movement_rental_only();

-- Tipo do produto não muda depois que houve movimento ou OS (histórico coerente).
create or replace function app.product_kind_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.kind is distinct from old.kind and (
       exists (select 1 from public.towel_movements m where m.product_id = old.id)
    or exists (select 1 from public.linen_service_order_items i where i.product_id = old.id)
  ) then
    raise exception 'Produto com histórico não pode mudar de tipo' using errcode = 'check_violation';
  end if;
  return new;
end
$$;

-- Atendimento na parada: coleta de enxoval não depende de saldo (é o rol contado na hora).
alter table public.stop_operation_items add column is_linen boolean not null default false;
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.stop_operation_items'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%collected <= customer_balance_before%'
  loop
    execute format('alter table public.stop_operation_items drop constraint %I', c.conname);
  end loop;
end
$$;
alter table public.stop_operation_items
  add constraint stop_operation_items_collect_within_balance check (is_linen or collected <= customer_balance_before);

-- -----------------------------------------------------------------------------
-- Ordens de serviço
-- -----------------------------------------------------------------------------
create table public.service_order_counters (
  organization_id  uuid primary key references public.organizations (id) on delete restrict,
  last_number      bigint not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create or replace function app.next_service_order_number(p_org uuid) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare v bigint;
begin
  if p_org is distinct from app.current_org_id() then
    raise exception 'Organização inválida para numeração';
  end if;
  insert into public.service_order_counters as c (organization_id, last_number) values (p_org, 1)
  on conflict (organization_id) do update set last_number = c.last_number + 1, updated_at = now()
  returning last_number into v;
  return v;
end
$$;
revoke all on function app.next_service_order_number(uuid) from public;
grant execute on function app.next_service_order_number(uuid) to app_user;

create table public.linen_service_orders (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations (id) on delete restrict,
  number                 bigint not null,
  customer_id            uuid not null,
  status                 text not null default 'COLLECTED' check (status in ('COLLECTED', 'READY', 'DELIVERED', 'CANCELLED')),
  -- Coleta registrada na parada (uma OS por atendimento).
  collection_operation_id uuid unique,
  collected_at           timestamptz not null default now(),
  ready_at               timestamptz,
  delivered_at           timestamptz,
  delivery_order_id      uuid,
  delivery_operation_id  uuid,
  notes                  text check (notes is null or length(notes) <= 1000),
  divergence_note        text check (divergence_note is null or length(divergence_note) <= 1000),
  status_reason          text check (status_reason is null or length(status_reason) <= 500),
  created_by             uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (organization_id, number),
  unique (organization_id, id),
  foreign key (organization_id, customer_id) references public.customers (organization_id, id) on delete restrict,
  foreign key (organization_id, delivery_order_id) references public.orders (organization_id, id) on delete restrict,
  foreign key (collection_operation_id) references public.stop_operations (id) on delete restrict,
  foreign key (delivery_operation_id) references public.stop_operations (id) on delete restrict
);
create index linen_so_org_status_idx on public.linen_service_orders (organization_id, status, collected_at desc);
create index linen_so_customer_idx on public.linen_service_orders (organization_id, customer_id, collected_at desc);
create index linen_so_delivery_order_idx on public.linen_service_orders (delivery_order_id) where delivery_order_id is not null;
create trigger linen_so_set_updated_at before update on public.linen_service_orders
  for each row execute function app.set_updated_at();
create trigger linen_so_no_delete before delete on public.linen_service_orders
  for each row execute function app.prevent_mutation();

create table public.linen_service_order_items (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null,
  service_order_id    uuid not null,
  product_id          uuid not null,
  -- Rol da coleta (base da cobrança por peça).
  collected           integer not null check (collected between 1 and 100000),
  -- Peças que já chegaram com dano (registro de responsabilidade).
  damaged_on_arrival  integer not null default 0 check (damaged_on_arrival >= 0 and damaged_on_arrival <= collected),
  returned            integer check (returned is null or returned between 0 and 100000),
  delivered           integer check (delivered is null or delivered between 0 and 100000),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (service_order_id, product_id),
  foreign key (organization_id, service_order_id) references public.linen_service_orders (organization_id, id) on delete restrict,
  foreign key (organization_id, product_id) references public.products (organization_id, id) on delete restrict
);
create index linen_soi_org_idx on public.linen_service_order_items (organization_id);
create index linen_soi_product_idx on public.linen_service_order_items (product_id);
create trigger linen_soi_set_updated_at before update on public.linen_service_order_items
  for each row execute function app.set_updated_at();
create trigger linen_soi_no_delete before delete on public.linen_service_order_items
  for each row execute function app.prevent_mutation();

create table public.linen_service_order_events (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  service_order_id  uuid not null,
  from_status       text,
  to_status         text not null,
  note              text check (note is null or length(note) <= 1000),
  actor_type        text not null check (actor_type in ('USER', 'INTEGRATION', 'SYSTEM')),
  actor_id          uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (organization_id, service_order_id) references public.linen_service_orders (organization_id, id) on delete restrict
);
create index linen_soe_so_idx on public.linen_service_order_events (service_order_id, created_at);
create index linen_soe_org_idx on public.linen_service_order_events (organization_id);
create trigger linen_soe_append_only before update or delete on public.linen_service_order_events
  for each row execute function app.prevent_mutation();

create trigger products_kind_guard before update of kind on public.products
  for each row execute function app.product_kind_guard();

-- -----------------------------------------------------------------------------
-- RLS + GRANTs
-- -----------------------------------------------------------------------------
alter table public.service_order_counters     enable row level security;
alter table public.linen_service_orders       enable row level security;
alter table public.linen_service_order_items  enable row level security;
alter table public.linen_service_order_events enable row level security;

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on public.service_order_counters, public.linen_service_orders, public.linen_service_order_items, public.linen_service_order_events from %I', r);
    end if;
  end loop;
end
$$;

grant select, insert, update on public.linen_service_orders to app_user;
grant select, insert, update on public.linen_service_order_items to app_user;
grant select, insert on public.linen_service_order_events to app_user;

-- Leitura: lavanderia, pedidos/rotas, motorista (coleta/entrega) e contratos (cobrança).
create policy linen_so_select on public.linen_service_orders for select to app_user
  using (
    organization_id = (select app.current_org_id())
    and (
      (select app.has_permission('laundry.read')) or (select app.has_permission('order.read'))
      or (select app.has_permission('operation.execute')) or (select app.has_permission('contract.read'))
    )
  );
create policy linen_so_insert on public.linen_service_orders for insert to app_user
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('operation.execute')));
create policy linen_so_update on public.linen_service_orders for update to app_user
  using (
    organization_id = (select app.current_org_id())
    and ((select app.has_permission('laundry.manage')) or (select app.has_permission('operation.execute')) or (select app.has_permission('order.create')))
  )
  with check (
    organization_id = (select app.current_org_id())
    and ((select app.has_permission('laundry.manage')) or (select app.has_permission('operation.execute')) or (select app.has_permission('order.create')))
  );

create policy linen_soi_select on public.linen_service_order_items for select to app_user
  using (organization_id = (select app.current_org_id()) and exists (select 1 from public.linen_service_orders s where s.id = linen_service_order_items.service_order_id));
create policy linen_soi_insert on public.linen_service_order_items for insert to app_user
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('operation.execute')));
create policy linen_soi_update on public.linen_service_order_items for update to app_user
  using (organization_id = (select app.current_org_id()) and ((select app.has_permission('laundry.manage')) or (select app.has_permission('operation.execute'))))
  with check (organization_id = (select app.current_org_id()) and ((select app.has_permission('laundry.manage')) or (select app.has_permission('operation.execute'))));

create policy linen_soe_select on public.linen_service_order_events for select to app_user
  using (organization_id = (select app.current_org_id()) and exists (select 1 from public.linen_service_orders s where s.id = linen_service_order_events.service_order_id));
create policy linen_soe_insert on public.linen_service_order_events for insert to app_user
  with check (
    organization_id = (select app.current_org_id())
    and actor_type = (select app.current_actor_type()) and actor_id is not distinct from (select app.current_actor_id())
  );

-- -----------------------------------------------------------------------------
-- Perfil Operador (lavanderia/separação): sem clientes, pedidos, contratos ou financeiro.
-- -----------------------------------------------------------------------------
do $$
declare o record; v_role uuid;
begin
  for o in select id from public.organizations loop
    insert into public.roles (organization_id, code, name, description, is_system)
    values (o.id, 'OPERATOR', 'Operador', 'Lavanderia e separação de rotas. Sem clientes, contratos ou financeiro.', true)
    on conflict (organization_id, code) do nothing
    returning id into v_role;
    if v_role is not null then
      insert into public.role_permissions (organization_id, role_id, permission_code)
      select o.id, v_role, code from public.permissions
      where code in ('admin.access', 'product.read', 'laundry.read', 'laundry.manage', 'incident.report', 'route.read');
    end if;
  end loop;
end
$$;

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

  insert into public.roles (organization_id, code, name, description, is_system, mfa_required)
  values (v_org, 'ADMIN', 'Administrador', 'Acesso total. MFA obrigatório.', true, true) returning id into v_role;
  insert into public.role_permissions (organization_id, role_id, permission_code)
  select v_org, v_role, code from public.permissions;

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

  insert into public.roles (organization_id, code, name, description, is_system)
  values (v_org, 'OPERATOR', 'Operador', 'Lavanderia e separação de rotas. Sem clientes, contratos ou financeiro.', true) returning id into v_role;
  insert into public.role_permissions (organization_id, role_id, permission_code)
  select v_org, v_role, code from public.permissions
  where code in ('admin.access', 'product.read', 'laundry.read', 'laundry.manage', 'incident.report', 'route.read');

  insert into public.roles (organization_id, code, name, description, is_system)
  values (v_org, 'DRIVER', 'Motorista', 'Somente as próprias rotas. Sem acesso financeiro.', true) returning id into v_role;
  insert into public.role_permissions (organization_id, role_id, permission_code)
  select v_org, v_role, code from public.permissions
  where code in ('driver_app.access', 'operation.execute', 'incident.report');

  insert into public.roles (organization_id, code, name, description, is_system)
  values (v_org, 'CUSTOMER', 'Cliente', 'Portal do cliente: somente dados próprios.', true) returning id into v_role;
  insert into public.role_permissions (organization_id, role_id, permission_code)
  select v_org, v_role, code from public.permissions where code in ('portal.access');

  insert into public.roles (organization_id, code, name, description, is_system)
  values (v_org, 'INTEGRATION', 'Integração', 'Token de API para o n8n. Permissões mínimas.', true) returning id into v_role;
  insert into public.role_permissions (organization_id, role_id, permission_code)
  select v_org, v_role, code from public.permissions
  where code in ('order.create_draft', 'jobs.run', 'notifications.callback');

  return v_org;
end
$$;
revoke all on function app.bootstrap_organization(text, text) from public;
