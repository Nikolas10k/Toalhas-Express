-- =============================================================================
-- Fase 4 — Pedidos, itens, histórico de status e recorrência.
-- Máquina de estados: src/server/modules/orders/orders.domain.ts (fonte única).
-- A reserva de estoque é feita por movimentos no ledger (towel_movements com
-- order_id); o pedido não guarda saldo reservado — ele é derivado.
-- =============================================================================

create table public.order_counters (
  organization_id  uuid primary key references public.organizations (id) on delete restrict,
  last_number      bigint not null default 0,
  updated_at       timestamptz not null default now(),
  created_at       timestamptz not null default now()
);

-- Numeração sequencial por organização, sem buracos por concorrência (lock de linha).
create or replace function app.next_order_number(p_org uuid) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare v bigint;
begin
  if p_org is distinct from app.current_org_id() and app.current_actor_type() <> 'SYSTEM' then
    raise exception 'Organização inválida para numeração';
  end if;
  insert into public.order_counters as c (organization_id, last_number) values (p_org, 1)
  on conflict (organization_id) do update set last_number = c.last_number + 1, updated_at = now()
  returning last_number into v;
  return v;
end
$$;
revoke all on function app.next_order_number(uuid) from public;
grant execute on function app.next_order_number(uuid) to app_user;

create table public.recurring_order_rules (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete restrict,
  customer_id      uuid not null,
  order_type       text not null check (order_type in ('DELIVERY', 'COLLECTION', 'DELIVERY_AND_COLLECTION')),
  -- ISO: 1 = segunda ... 7 = domingo
  weekdays         smallint[] not null check (cardinality(weekdays) between 1 and 7 and weekdays <@ array[1,2,3,4,5,6,7]::smallint[]),
  window_start     time,
  window_end       time,
  items            jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 20),
  notes            text check (notes is null or length(notes) <= 1000),
  starts_on        date not null,
  ends_on          date,
  active           boolean not null default true,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on),
  check (window_start is null or window_end is null or window_end > window_start),
  unique (organization_id, id),
  foreign key (organization_id, customer_id) references public.customers (organization_id, id) on delete restrict
);
create index recurring_order_rules_org_active_idx on public.recurring_order_rules (organization_id, active);
create index recurring_order_rules_customer_idx on public.recurring_order_rules (organization_id, customer_id);
create trigger recurring_order_rules_set_updated_at before update on public.recurring_order_rules
  for each row execute function app.set_updated_at();
create trigger recurring_order_rules_no_delete before delete on public.recurring_order_rules
  for each row execute function app.prevent_mutation();

create table public.orders (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete restrict,
  number              bigint not null,
  customer_id         uuid not null,
  contract_id         uuid,
  order_type          text not null check (order_type in ('DELIVERY', 'COLLECTION', 'DELIVERY_AND_COLLECTION')),
  status              text not null check (status in ('DRAFT', 'NEW', 'CONFIRMED', 'PREPARING', 'READY', 'ROUTE_ASSIGNED',
                        'IN_TRANSIT', 'DELIVERED', 'DELIVERY_PROBLEM', 'RESCHEDULED', 'CANCELLED', 'COMPLETED')),
  scheduled_date      date not null,
  window_start        time,
  window_end          time,
  -- Endereço congelado no momento do pedido (alterar o cadastro não muda pedidos já feitos).
  address             jsonb not null default '{}'::jsonb,
  latitude            numeric(9, 6),
  longitude           numeric(9, 6),
  notes               text check (notes is null or length(notes) <= 1000),
  internal_notes      text check (internal_notes is null or length(internal_notes) <= 1000),
  assigned_to         uuid references public.profiles (id) on delete restrict,
  route_id            uuid,
  driver_id           uuid,
  source              text not null check (source in ('ADMIN', 'PORTAL', 'INTEGRATION', 'RECURRENCE')),
  recurring_rule_id   uuid,
  occurrence_date     date,
  stock_override      boolean not null default false,
  status_reason       text check (status_reason is null or length(status_reason) <= 500),
  status_changed_at   timestamptz not null default now(),
  created_by          uuid,
  idempotency_key     text unique check (idempotency_key is null or length(idempotency_key) between 8 and 200),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (window_start is null or window_end is null or window_end > window_start),
  check ((recurring_rule_id is null) = (occurrence_date is null)),
  unique (organization_id, number),
  unique (organization_id, id),
  foreign key (organization_id, customer_id) references public.customers (organization_id, id) on delete restrict,
  foreign key (organization_id, recurring_rule_id) references public.recurring_order_rules (organization_id, id) on delete restrict
);
-- Recorrência: chave rule_id:data — nunca dois pedidos para a mesma ocorrência.
create unique index orders_recurrence_uidx on public.orders (recurring_rule_id, occurrence_date) where recurring_rule_id is not null;
create index orders_org_status_date_idx on public.orders (organization_id, status, scheduled_date);
create index orders_org_date_idx on public.orders (organization_id, scheduled_date, id);
create index orders_org_created_idx on public.orders (organization_id, created_at desc, id desc);
create index orders_customer_idx on public.orders (organization_id, customer_id, scheduled_date desc);
create index orders_route_idx on public.orders (route_id) where route_id is not null;
create index orders_driver_idx on public.orders (driver_id) where driver_id is not null;
create trigger orders_set_updated_at before update on public.orders
  for each row execute function app.set_updated_at();
create trigger orders_no_delete before delete on public.orders
  for each row execute function app.prevent_mutation();

create table public.order_items (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null,
  order_id             uuid not null,
  product_id           uuid not null,
  delivery_quantity    integer not null default 0 check (delivery_quantity between 0 and 100000),
  collection_quantity  integer not null default 0 check (collection_quantity between 0 and 100000),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (delivery_quantity > 0 or collection_quantity > 0),
  unique (order_id, product_id),
  foreign key (organization_id, order_id) references public.orders (organization_id, id) on delete restrict,
  foreign key (organization_id, product_id) references public.products (organization_id, id) on delete restrict
);
create index order_items_org_idx on public.order_items (organization_id);
create index order_items_product_idx on public.order_items (product_id);
create trigger order_items_set_updated_at before update on public.order_items
  for each row execute function app.set_updated_at();

create table public.order_status_history (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  order_id         uuid not null,
  from_status      text,
  to_status        text not null,
  reason           text check (reason is null or length(reason) <= 500),
  metadata         jsonb not null default '{}'::jsonb,
  actor_type       text not null check (actor_type in ('USER', 'INTEGRATION', 'SYSTEM')),
  actor_id         uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (organization_id, order_id) references public.orders (organization_id, id) on delete restrict
);
create index order_status_history_order_idx on public.order_status_history (order_id, created_at);
create index order_status_history_org_idx on public.order_status_history (organization_id);
create trigger order_status_history_append_only before update or delete on public.order_status_history
  for each row execute function app.prevent_mutation();

-- FKs do ledger para pedidos (a coluna já existia desde a Fase 3).
alter table public.towel_movements
  add constraint towel_movements_order_fk foreign key (organization_id, order_id)
  references public.orders (organization_id, id) on delete restrict;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.order_counters        enable row level security;
alter table public.recurring_order_rules enable row level security;
alter table public.orders                enable row level security;
alter table public.order_items           enable row level security;
alter table public.order_status_history  enable row level security;

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on public.order_counters, public.recurring_order_rules, public.orders, public.order_items, public.order_status_history from %I', r);
    end if;
  end loop;
end
$$;

grant select, insert, update on public.orders, public.recurring_order_rules to app_user;
grant select, insert on public.order_items to app_user;
grant select, insert on public.order_status_history to app_user;

-- Quem enxerga o pedido: equipe (order.read) ou o próprio cliente (portal).
create or replace function app.can_see_customer_record(p_customer uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.has_permission('order.read')
      or (app.has_permission('portal.access') and p_customer = any (app.current_customer_ids()))
$$;
revoke all on function app.can_see_customer_record(uuid) from public;
grant execute on function app.can_see_customer_record(uuid) to app_user;

create policy orders_select on public.orders for select to app_user
  using (
    organization_id = (select app.current_org_id())
    and (
      app.can_see_customer_record(customer_id)
      -- Token de integração só enxerga os rascunhos que ele mesmo criou.
      or ((select app.current_actor_type()) = 'INTEGRATION' and created_by = (select app.current_integration_token_id()))
    )
  );
create policy orders_insert on public.orders for insert to app_user
  with check (
    organization_id = (select app.current_org_id())
    and (
      (select app.has_permission('order.create'))
      or ((select app.has_permission('order.create_draft')) and status = 'DRAFT')
      or ((select app.has_permission('portal.access')) and customer_id = any (coalesce((select app.current_customer_ids()), '{}'::uuid[])))
    )
  );
create policy orders_update on public.orders for update to app_user
  using (
    organization_id = (select app.current_org_id())
    and (
      (select app.has_permission('order.update')) or (select app.has_permission('order.cancel'))
      or ((select app.has_permission('portal.access')) and customer_id = any (coalesce((select app.current_customer_ids()), '{}'::uuid[])))
    )
  )
  with check (organization_id = (select app.current_org_id()));

create policy order_items_select on public.order_items for select to app_user
  using (
    organization_id = (select app.current_org_id())
    and exists (select 1 from public.orders o where o.id = order_items.order_id)
  );
create policy order_items_insert on public.order_items for insert to app_user
  with check (organization_id = (select app.current_org_id()) and exists (select 1 from public.orders o where o.id = order_items.order_id));

create policy order_status_history_select on public.order_status_history for select to app_user
  using (organization_id = (select app.current_org_id()) and exists (select 1 from public.orders o where o.id = order_status_history.order_id));
create policy order_status_history_insert on public.order_status_history for insert to app_user
  with check (
    organization_id = (select app.current_org_id())
    and actor_type = (select app.current_actor_type())
    and actor_id is not distinct from (select app.current_actor_id())
    and exists (select 1 from public.orders o where o.id = order_status_history.order_id)
  );

create policy recurring_rules_select on public.recurring_order_rules for select to app_user
  using (organization_id = (select app.current_org_id()) and app.can_see_customer_record(customer_id));
create policy recurring_rules_write on public.recurring_order_rules for insert to app_user
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('order.create')));
create policy recurring_rules_update on public.recurring_order_rules for update to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('order.create')))
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('order.create')));
