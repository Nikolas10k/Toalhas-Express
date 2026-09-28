-- =============================================================================
-- Fase 7 — Lavanderia.
--
-- coleta → recebimento/conferência (laundry_receipts) → laundry_batches
--   WAITING → WASHING → DRYING → FOLDING → INSPECTION → COMPLETED (| CANCELLED)
-- A inspeção destina cada toalha para disponível, danificada ou descarte.
-- Todo efeito de estoque passa pelo ledger (towel_movements).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Recebimento/conferência do que voltou das rotas
-- -----------------------------------------------------------------------------
create table public.laundry_receipts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete restrict,
  route_id         uuid not null,
  notes            text check (notes is null or length(notes) <= 1000),
  actor_type       text not null check (actor_type in ('USER', 'INTEGRATION', 'SYSTEM')),
  actor_id         uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Cada rota é conferida uma única vez.
  unique (route_id),
  unique (organization_id, id),
  foreign key (organization_id, route_id) references public.routes (organization_id, id) on delete restrict
);
create index laundry_receipts_org_idx on public.laundry_receipts (organization_id, created_at desc);
create trigger laundry_receipts_append_only before update or delete on public.laundry_receipts
  for each row execute function app.prevent_mutation();

create table public.laundry_receipt_items (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  receipt_id       uuid not null,
  product_id       uuid not null,
  expected         integer not null check (expected >= 0),
  counted          integer not null check (counted between 0 and 100000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (receipt_id, product_id),
  foreign key (organization_id, receipt_id) references public.laundry_receipts (organization_id, id) on delete restrict,
  foreign key (organization_id, product_id) references public.products (organization_id, id) on delete restrict
);
create index laundry_receipt_items_org_idx on public.laundry_receipt_items (organization_id);
create index laundry_receipt_items_product_idx on public.laundry_receipt_items (product_id);
create trigger laundry_receipt_items_append_only before update or delete on public.laundry_receipt_items
  for each row execute function app.prevent_mutation();

-- -----------------------------------------------------------------------------
-- Lotes
-- -----------------------------------------------------------------------------
create table public.laundry_counters (
  organization_id  uuid primary key references public.organizations (id) on delete restrict,
  last_number      bigint not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create or replace function app.next_laundry_number(p_org uuid) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare v bigint;
begin
  if p_org is distinct from app.current_org_id() then
    raise exception 'Organização inválida para numeração';
  end if;
  insert into public.laundry_counters as c (organization_id, last_number) values (p_org, 1)
  on conflict (organization_id) do update set last_number = c.last_number + 1, updated_at = now()
  returning last_number into v;
  return v;
end
$$;
revoke all on function app.next_laundry_number(uuid) from public;
grant execute on function app.next_laundry_number(uuid) to app_user;

create table public.laundry_batches (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete restrict,
  number           bigint not null,
  status           text not null default 'WAITING'
                   check (status in ('WAITING', 'WASHING', 'DRYING', 'FOLDING', 'INSPECTION', 'COMPLETED', 'CANCELLED')),
  -- Lavanderia própria ou terceirizada (nome livre).
  provider         text check (provider is null or length(provider) <= 120),
  notes            text check (notes is null or length(notes) <= 1000),
  status_reason    text check (status_reason is null or length(status_reason) <= 500),
  started_at       timestamptz,
  completed_at     timestamptz,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, number),
  unique (organization_id, id)
);
create index laundry_batches_org_status_idx on public.laundry_batches (organization_id, status, created_at desc);
create trigger laundry_batches_set_updated_at before update on public.laundry_batches
  for each row execute function app.set_updated_at();
create trigger laundry_batches_no_delete before delete on public.laundry_batches
  for each row execute function app.prevent_mutation();

create table public.laundry_batch_items (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  batch_id         uuid not null,
  product_id       uuid not null,
  quantity         integer not null check (quantity between 1 and 100000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (batch_id, product_id),
  foreign key (organization_id, batch_id) references public.laundry_batches (organization_id, id) on delete restrict,
  foreign key (organization_id, product_id) references public.products (organization_id, id) on delete restrict
);
create index laundry_batch_items_org_idx on public.laundry_batch_items (organization_id);
create index laundry_batch_items_product_idx on public.laundry_batch_items (product_id);
create trigger laundry_batch_items_append_only before update or delete on public.laundry_batch_items
  for each row execute function app.prevent_mutation();

-- Resultado da inspeção por produto (uma vez; soma fecha com a quantidade do lote no service).
create table public.laundry_inspections (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  batch_id         uuid not null,
  product_id       uuid not null,
  available        integer not null check (available >= 0),
  damaged          integer not null check (damaged >= 0),
  discarded        integer not null check (discarded >= 0),
  notes            text check (notes is null or length(notes) <= 500),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (batch_id, product_id),
  foreign key (organization_id, batch_id) references public.laundry_batches (organization_id, id) on delete restrict,
  foreign key (organization_id, product_id) references public.products (organization_id, id) on delete restrict
);
create index laundry_inspections_org_idx on public.laundry_inspections (organization_id);
create index laundry_inspections_product_idx on public.laundry_inspections (product_id);
create trigger laundry_inspections_append_only before update or delete on public.laundry_inspections
  for each row execute function app.prevent_mutation();

create table public.laundry_batch_events (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  batch_id         uuid not null,
  from_status      text,
  to_status        text not null,
  note             text check (note is null or length(note) <= 500),
  actor_type       text not null check (actor_type in ('USER', 'INTEGRATION', 'SYSTEM')),
  actor_id         uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (organization_id, batch_id) references public.laundry_batches (organization_id, id) on delete restrict
);
create index laundry_batch_events_batch_idx on public.laundry_batch_events (batch_id, created_at);
create index laundry_batch_events_org_idx on public.laundry_batch_events (organization_id);
create trigger laundry_batch_events_append_only before update or delete on public.laundry_batch_events
  for each row execute function app.prevent_mutation();

alter table public.towel_movements
  add constraint towel_movements_laundry_batch_fk foreign key (organization_id, laundry_batch_id)
  references public.laundry_batches (organization_id, id) on delete restrict;
create index towel_movements_laundry_batch_idx on public.towel_movements (laundry_batch_id) where laundry_batch_id is not null;

-- -----------------------------------------------------------------------------
-- RLS + GRANTs
-- -----------------------------------------------------------------------------
alter table public.laundry_receipts      enable row level security;
alter table public.laundry_receipt_items enable row level security;
alter table public.laundry_counters      enable row level security;
alter table public.laundry_batches       enable row level security;
alter table public.laundry_batch_items   enable row level security;
alter table public.laundry_inspections   enable row level security;
alter table public.laundry_batch_events  enable row level security;

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on public.laundry_receipts, public.laundry_receipt_items, public.laundry_counters, public.laundry_batches, '
                     'public.laundry_batch_items, public.laundry_inspections, public.laundry_batch_events from %I', r);
    end if;
  end loop;
end
$$;

grant select, insert on public.laundry_receipts, public.laundry_receipt_items, public.laundry_batch_items,
                         public.laundry_inspections, public.laundry_batch_events to app_user;
grant select, insert on public.laundry_batches to app_user;
grant update (status, status_reason, started_at, completed_at, notes, provider) on public.laundry_batches to app_user;

create policy laundry_receipts_select on public.laundry_receipts for select to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('laundry.read')));
create policy laundry_receipts_insert on public.laundry_receipts for insert to app_user
  with check (
    organization_id = (select app.current_org_id()) and (select app.has_permission('laundry.manage'))
    and actor_type = (select app.current_actor_type()) and actor_id is not distinct from (select app.current_actor_id())
  );
create policy laundry_receipt_items_select on public.laundry_receipt_items for select to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('laundry.read')));
create policy laundry_receipt_items_insert on public.laundry_receipt_items for insert to app_user
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('laundry.manage')));

create policy laundry_batches_select on public.laundry_batches for select to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('laundry.read')));
create policy laundry_batches_insert on public.laundry_batches for insert to app_user
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('laundry.manage')));
create policy laundry_batches_update on public.laundry_batches for update to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('laundry.manage')))
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('laundry.manage')));

create policy laundry_batch_items_select on public.laundry_batch_items for select to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('laundry.read')));
create policy laundry_batch_items_insert on public.laundry_batch_items for insert to app_user
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('laundry.manage')));

create policy laundry_inspections_select on public.laundry_inspections for select to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('laundry.read')));
create policy laundry_inspections_insert on public.laundry_inspections for insert to app_user
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('laundry.manage')));

create policy laundry_batch_events_select on public.laundry_batch_events for select to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('laundry.read')));
create policy laundry_batch_events_insert on public.laundry_batch_events for insert to app_user
  with check (
    organization_id = (select app.current_org_id()) and (select app.has_permission('laundry.manage'))
    and actor_type = (select app.current_actor_type()) and actor_id is not distinct from (select app.current_actor_id())
  );

-- -----------------------------------------------------------------------------
-- Leituras da lavanderia com permissão própria (laundry.read), sem abrir o
-- estoque inteiro nem as rotas para quem só opera a lavanderia.
-- -----------------------------------------------------------------------------
create or replace function app.laundry_queue()
returns table (product_id uuid, sku text, name text, awaiting bigint, in_laundry bigint, in_inspection bigint)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.sku, p.name,
         coalesce(sum(b.quantity) filter (where b.state = 'AWAITING_LAUNDRY'), 0)::bigint,
         coalesce(sum(b.quantity) filter (where b.state = 'IN_LAUNDRY'), 0)::bigint,
         coalesce(sum(b.quantity) filter (where b.state = 'IN_INSPECTION'), 0)::bigint
    from public.products p
    left join public.stock_balances b on b.product_id = p.id and b.organization_id = p.organization_id
   where p.organization_id = app.current_org_id() and app.has_permission('laundry.read')
   group by p.id, p.sku, p.name
   order by p.name
$$;

-- Rotas concluídas com coleta ainda não conferida na base (esperado = coletado nas paradas).
create or replace function app.pending_laundry_receipts()
returns table (route_id uuid, route_date date, driver_name text, product_id uuid, product_name text, expected bigint)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.route_date, d.full_name, m.product_id, p.name, sum(m.quantity)::bigint
    from public.routes r
    join public.drivers d on d.id = r.driver_id
    join public.towel_movements m on m.route_id = r.id and m.movement_type = 'COLLECTION' and m.to_state = 'AWAITING_LAUNDRY'
    join public.products p on p.id = m.product_id
   where r.organization_id = app.current_org_id() and app.has_permission('laundry.read')
     and r.status = 'COMPLETED'
     and not exists (select 1 from public.laundry_receipts lr where lr.route_id = r.id)
   group by r.id, r.route_date, d.full_name, m.product_id, p.name
   order by r.route_date, r.id, p.name
$$;

revoke all on function app.laundry_queue(), app.pending_laundry_receipts() from public;
grant execute on function app.laundry_queue(), app.pending_laundry_receipts() to app_user;
