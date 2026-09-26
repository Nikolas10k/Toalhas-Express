-- =============================================================================
-- Fase 3 — Produtos, ledger de estoque (towel_movements) e saldos derivados.
--
-- Toalhas são ativos circulantes. TODO movimento é uma transferência de
-- quantidade de um estado para outro (EXTERNAL = fora do sistema). Os saldos
-- em stock_balances são um CACHE derivado, mantido exclusivamente por trigger
-- a partir do ledger — nunca editados diretamente. A verificação de
-- consistência recalcula tudo a partir do ledger e gera alerta se divergir.
-- =============================================================================

create table public.products (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references public.organizations (id) on delete restrict,
  sku                      text not null check (sku ~ '^[A-Z0-9][A-Z0-9._-]{0,39}$'),
  name                     text not null check (length(btrim(name)) between 2 and 120),
  size                     text check (size is null or length(size) <= 40),
  category                 text check (category is null or length(category) <= 60),
  cost_cents               bigint not null default 0 check (cost_cents >= 0),
  replacement_price_cents  bigint not null default 0 check (replacement_price_cents >= 0),
  min_stock                integer not null default 0 check (min_stock >= 0),
  active                   boolean not null default true,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  deleted_at               timestamptz,
  unique (organization_id, sku),
  unique (organization_id, id)
);
create index products_org_active_idx on public.products (organization_id, active);
create trigger products_set_updated_at before update on public.products
  for each row execute function app.set_updated_at();
create trigger products_no_delete before delete on public.products
  for each row execute function app.prevent_mutation();

-- Estados possíveis de uma toalha. EXTERNAL não é contado no total.
create or replace function app.inventory_states() returns text[]
language sql immutable set search_path = ''
as $$ select array['EXTERNAL', 'AVAILABLE', 'RESERVED', 'IN_ROUTE', 'WITH_CUSTOMER', 'AWAITING_LAUNDRY',
                   'IN_LAUNDRY', 'IN_INSPECTION', 'DAMAGED', 'LOST', 'DISCARDED'] $$;

create table public.towel_movements (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id) on delete restrict,
  product_id            uuid not null,
  movement_type         text not null check (movement_type in (
                          'STOCK_ENTRY', 'RESERVATION', 'RESERVATION_RELEASE', 'DELIVERY_DISPATCH', 'DELIVERY',
                          'COLLECTION', 'LAUNDRY_ENTRY', 'LAUNDRY_EXIT', 'TRANSFER', 'DAMAGE', 'LOSS', 'DISCARD',
                          'MANUAL_ADJUSTMENT')),
  quantity              integer not null check (quantity > 0 and quantity <= 1000000),
  from_state            text not null,
  to_state              text not null,
  -- Cliente dono do saldo quando from/to = WITH_CUSTOMER (obrigatório nesses casos).
  customer_id           uuid,
  order_id              uuid,
  route_id              uuid,
  route_stop_id         uuid,
  driver_id             uuid,
  laundry_batch_id      uuid,
  reason                text check (reason is null or length(reason) <= 500),
  -- Override autorizado (Fase 4): permite saldo negativo, sempre auditado e com alerta.
  allow_negative        boolean not null default false,
  reverses_movement_id  uuid references public.towel_movements (id) on delete restrict,
  actor_type            text not null check (actor_type in ('USER', 'INTEGRATION', 'SYSTEM')),
  actor_id              uuid,
  idempotency_key       text unique check (idempotency_key is null or length(idempotency_key) between 8 and 200),
  correlation_id        text,
  occurred_at           timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (from_state = any (app.inventory_states()) and to_state = any (app.inventory_states())),
  check (from_state <> to_state),
  check ((from_state <> 'WITH_CUSTOMER' and to_state <> 'WITH_CUSTOMER') or customer_id is not null),
  foreign key (organization_id, product_id) references public.products (organization_id, id) on delete restrict,
  foreign key (organization_id, customer_id) references public.customers (organization_id, id) on delete restrict
);
create index towel_movements_org_occurred_idx on public.towel_movements (organization_id, occurred_at desc, id desc);
create index towel_movements_product_idx on public.towel_movements (organization_id, product_id, occurred_at desc);
create index towel_movements_customer_idx on public.towel_movements (organization_id, customer_id, occurred_at desc) where customer_id is not null;
create index towel_movements_type_idx on public.towel_movements (organization_id, movement_type);
create index towel_movements_order_idx on public.towel_movements (order_id) where order_id is not null;
create index towel_movements_route_idx on public.towel_movements (route_id) where route_id is not null;
create index towel_movements_reverses_idx on public.towel_movements (reverses_movement_id) where reverses_movement_id is not null;
create trigger towel_movements_append_only before update or delete on public.towel_movements
  for each row execute function app.prevent_mutation();
create trigger towel_movements_no_truncate before truncate on public.towel_movements
  for each statement execute function app.prevent_mutation();

-- Cache de saldos por (produto, estado, cliente). customer_key = cliente ou zero.
create table public.stock_balances (
  organization_id     uuid not null,
  product_id          uuid not null,
  state               text not null check (state = any (app.inventory_states()) and state <> 'EXTERNAL'),
  customer_key        uuid not null default '00000000-0000-0000-0000-000000000000',
  customer_id         uuid,
  quantity            integer not null default 0,
  last_delivery_at    timestamptz,
  last_collection_at  timestamptz,
  last_movement_at    timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  primary key (organization_id, product_id, state, customer_key),
  check ((state = 'WITH_CUSTOMER') = (customer_id is not null)),
  foreign key (organization_id, product_id) references public.products (organization_id, id) on delete restrict
);
create index stock_balances_customer_idx on public.stock_balances (organization_id, customer_id) where customer_id is not null;
create index stock_balances_state_idx on public.stock_balances (organization_id, state);

-- Aplica um movimento aos saldos. SECURITY DEFINER: app_user não escreve em
-- stock_balances; a única porta de entrada é inserir um movimento válido.
-- O UPDATE na linha do saldo trava a linha (lock de linha) — duas reservas
-- concorrentes serializam aqui e a segunda vê o saldo já reduzido.
create or replace function app.apply_towel_movement() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_zero constant uuid := '00000000-0000-0000-0000-000000000000';
  v_from_key uuid := case when new.from_state = 'WITH_CUSTOMER' then new.customer_id else v_zero end;
  v_to_key uuid := case when new.to_state = 'WITH_CUSTOMER' then new.customer_id else v_zero end;
  v_remaining integer;
begin
  if new.from_state <> 'EXTERNAL' then
    insert into public.stock_balances as b (organization_id, product_id, state, customer_key, customer_id, quantity, last_movement_at)
    values (new.organization_id, new.product_id, new.from_state, v_from_key,
            case when new.from_state = 'WITH_CUSTOMER' then new.customer_id end, -new.quantity, new.occurred_at)
    on conflict (organization_id, product_id, state, customer_key)
    do update set quantity = b.quantity - new.quantity,
                  last_movement_at = greatest(b.last_movement_at, new.occurred_at),
                  last_collection_at = case when new.movement_type = 'COLLECTION'
                                            then greatest(b.last_collection_at, new.occurred_at) else b.last_collection_at end,
                  updated_at = now()
    returning quantity into v_remaining;

    if v_remaining < 0 and not new.allow_negative then
      raise exception 'Saldo insuficiente em % (faltam %)', new.from_state, -v_remaining
        using errcode = 'P0010', detail = format('product=%s state=%s customer=%s available=%s requested=%s',
          new.product_id, new.from_state, coalesce(new.customer_id::text, '-'), v_remaining + new.quantity, new.quantity);
    end if;
  end if;

  if new.to_state <> 'EXTERNAL' then
    insert into public.stock_balances as b (organization_id, product_id, state, customer_key, customer_id, quantity,
                                            last_delivery_at, last_movement_at)
    values (new.organization_id, new.product_id, new.to_state, v_to_key,
            case when new.to_state = 'WITH_CUSTOMER' then new.customer_id end, new.quantity,
            case when new.movement_type = 'DELIVERY' then new.occurred_at end, new.occurred_at)
    on conflict (organization_id, product_id, state, customer_key)
    do update set quantity = b.quantity + new.quantity,
                  last_movement_at = greatest(b.last_movement_at, new.occurred_at),
                  last_delivery_at = case when new.movement_type = 'DELIVERY'
                                          then greatest(b.last_delivery_at, new.occurred_at) else b.last_delivery_at end,
                  updated_at = now();
  end if;
  return new;
end
$$;
revoke all on function app.apply_towel_movement() from public;
create trigger towel_movements_apply after insert on public.towel_movements
  for each row execute function app.apply_towel_movement();

-- -----------------------------------------------------------------------------
-- Alertas do sistema (consistência, estoque mínimo; ampliado na Fase 12).
-- -----------------------------------------------------------------------------
create table public.system_alerts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete restrict,
  alert_type       text not null check (alert_type ~ '^[A-Z_]+$'),
  severity         text not null check (severity in ('INFO', 'WARNING', 'CRITICAL')),
  title            text not null check (length(title) <= 200),
  details          jsonb not null default '{}'::jsonb,
  status           text not null default 'OPEN' check (status in ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
  -- Um alerta aberto por chave (ex.: LOW_STOCK:<produto>): não repete a cada verificação.
  dedupe_key       text not null,
  resolved_at      timestamptz,
  resolved_by      uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index system_alerts_open_dedupe_uidx on public.system_alerts (organization_id, dedupe_key) where status <> 'RESOLVED';
create index system_alerts_org_status_idx on public.system_alerts (organization_id, status, created_at desc);
create trigger system_alerts_set_updated_at before update on public.system_alerts
  for each row execute function app.set_updated_at();
create trigger system_alerts_no_delete before delete on public.system_alerts
  for each row execute function app.prevent_mutation();

-- Recalcula saldos a partir do ledger e lista divergências com o cache.
create or replace function app.inventory_consistency(p_org uuid)
returns table (product_id uuid, state text, customer_id uuid, ledger_quantity bigint, cached_quantity bigint)
language sql stable set search_path = ''
as $$
  with deltas as (
    select m.product_id, m.from_state as state,
           case when m.from_state = 'WITH_CUSTOMER' then m.customer_id end as customer_id, -m.quantity::bigint as q
      from public.towel_movements m where m.organization_id = p_org and m.from_state <> 'EXTERNAL'
    union all
    select m.product_id, m.to_state,
           case when m.to_state = 'WITH_CUSTOMER' then m.customer_id end, m.quantity::bigint
      from public.towel_movements m where m.organization_id = p_org and m.to_state <> 'EXTERNAL'
  ),
  ledger as (
    select d.product_id, d.state, d.customer_id, sum(d.q) as q from deltas d group by 1, 2, 3
  ),
  cache as (
    select b.product_id, b.state, b.customer_id, b.quantity::bigint as q
      from public.stock_balances b where b.organization_id = p_org
  )
  select coalesce(l.product_id, c.product_id), coalesce(l.state, c.state), coalesce(l.customer_id, c.customer_id),
         coalesce(l.q, 0), coalesce(c.q, 0)
    from ledger l
    full join cache c
      on c.product_id = l.product_id and c.state = l.state
     and c.customer_id is not distinct from l.customer_id
   where coalesce(l.q, 0) <> coalesce(c.q, 0)
$$;
revoke all on function app.inventory_consistency(uuid) from public;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.products        enable row level security;
alter table public.towel_movements enable row level security;
alter table public.stock_balances  enable row level security;
alter table public.system_alerts   enable row level security;

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on public.products, public.towel_movements, public.stock_balances, public.system_alerts from %I', r);
    end if;
  end loop;
end
$$;

grant select, insert, update on public.products to app_user;
grant select, insert on public.towel_movements to app_user;
grant select on public.stock_balances to app_user;
grant select, update (status, resolved_at, resolved_by) on public.system_alerts to app_user;

create policy products_select on public.products for select to app_user
  using (organization_id = (select app.current_org_id()) and (select app.actor_in_current_org()));
create policy products_write on public.products for insert to app_user
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('product.manage')));
create policy products_update on public.products for update to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('product.manage')))
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('product.manage')));

-- Leitura do ledger: equipe com inventory.read; cliente vê os próprios movimentos.
create policy towel_movements_select on public.towel_movements for select to app_user
  using (
    organization_id = (select app.current_org_id())
    and (
      (select app.has_permission('inventory.read'))
      or ((select app.has_permission('portal.access')) and customer_id = any (coalesce((select app.current_customer_ids()), '{}'::uuid[])))
    )
  );
-- Inserção: qualquer papel operacional; o service valida a permissão específica de cada tipo.
create policy towel_movements_insert on public.towel_movements for insert to app_user
  with check (
    organization_id = (select app.current_org_id())
    and (select app.actor_in_current_org())
    and actor_type = (select app.current_actor_type())
    and actor_id is not distinct from (select app.current_actor_id())
    and (
      (select app.has_permission('inventory.move')) or (select app.has_permission('inventory.adjust'))
      or (select app.has_permission('operation.execute')) or (select app.has_permission('order.update'))
      or (select app.has_permission('laundry.manage'))
    )
  );

create policy stock_balances_select on public.stock_balances for select to app_user
  using (
    organization_id = (select app.current_org_id())
    and (
      (select app.has_permission('inventory.read'))
      or ((select app.has_permission('portal.access')) and customer_id = any (coalesce((select app.current_customer_ids()), '{}'::uuid[])))
    )
  );

create policy system_alerts_select on public.system_alerts for select to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('admin.access')));
create policy system_alerts_update on public.system_alerts for update to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('inventory.adjust')))
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('inventory.adjust')));

-- CHECKs de towel_movements/stock_balances chamam esta função.
grant execute on function app.inventory_states() to app_user;
