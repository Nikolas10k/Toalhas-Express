-- =============================================================================
-- Fase 8 — Contratos e regras de cobrança.
--
-- Status: DRAFT → ACTIVE ↔ SUSPENDED → ENDED; DRAFT → CANCELLED.
-- Um contrato vigente (ACTIVE/SUSPENDED) por cliente. Valores em centavos
-- BIGINT; desconto em pontos-base (1% = 100). Cada alteração gera uma
-- revisão imutável (além da auditoria).
-- =============================================================================

create table public.contract_counters (
  organization_id  uuid primary key references public.organizations (id) on delete restrict,
  last_number      bigint not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create or replace function app.next_contract_number(p_org uuid) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare v bigint;
begin
  if p_org is distinct from app.current_org_id() then
    raise exception 'Organização inválida para numeração';
  end if;
  insert into public.contract_counters as c (organization_id, last_number) values (p_org, 1)
  on conflict (organization_id) do update set last_number = c.last_number + 1, updated_at = now()
  returning last_number into v;
  return v;
end
$$;
revoke all on function app.next_contract_number(uuid) from public;
grant execute on function app.next_contract_number(uuid) to app_user;

create table public.contracts (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null references public.organizations (id) on delete restrict,
  number                    bigint not null,
  customer_id               uuid not null,
  status                    text not null default 'DRAFT' check (status in ('DRAFT', 'ACTIVE', 'SUSPENDED', 'ENDED', 'CANCELLED')),
  billing_type              text not null check (billing_type in ('MONTHLY_FIXED', 'PER_DELIVERY', 'PER_QUANTITY', 'HYBRID', 'CUSTOM')),
  starts_on                 date not null,
  ends_on                   date,
  renewal                   text not null default 'MANUAL' check (renewal in ('AUTO', 'MANUAL', 'NONE')),
  renewal_months            smallint not null default 12 check (renewal_months between 1 and 60),
  due_day                   smallint not null check (due_day between 1 and 28),
  monthly_fee_cents         bigint not null default 0 check (monthly_fee_cents >= 0),
  per_delivery_fee_cents    bigint not null default 0 check (per_delivery_fee_cents >= 0),
  discount_bp               integer not null default 0 check (discount_bp between 0 and 10000),
  prorate_first_month       boolean not null default true,
  custom_terms              text check (custom_terms is null or length(custom_terms) <= 4000),
  notes                     text check (notes is null or length(notes) <= 2000),
  status_reason             text check (status_reason is null or length(status_reason) <= 500),
  activated_at              timestamptz,
  ended_at                  timestamptz,
  revision                  integer not null default 1 check (revision >= 1),
  created_by                uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (organization_id, number),
  unique (organization_id, id),
  check (ends_on is null or ends_on >= starts_on),
  foreign key (organization_id, customer_id) references public.customers (organization_id, id) on delete restrict
);
-- Um contrato vigente por cliente.
create unique index contracts_customer_current_uidx on public.contracts (customer_id) where status in ('ACTIVE', 'SUSPENDED');
create index contracts_org_status_idx on public.contracts (organization_id, status, created_at desc);
create index contracts_customer_idx on public.contracts (organization_id, customer_id, created_at desc);
create index contracts_renewal_idx on public.contracts (organization_id, ends_on) where status = 'ACTIVE';
create trigger contracts_set_updated_at before update on public.contracts
  for each row execute function app.set_updated_at();
create trigger contracts_no_delete before delete on public.contracts
  for each row execute function app.prevent_mutation();

-- Itens do contrato (substituídos por inteiro a cada revisão; o histórico fica em contract_revisions).
create table public.contract_items (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null,
  contract_id           uuid not null,
  product_id            uuid not null,
  contracted_quantity   integer not null default 0 check (contracted_quantity between 0 and 1000000),
  franchise_quantity    integer not null default 0 check (franchise_quantity between 0 and 1000000),
  unit_price_cents      bigint not null default 0 check (unit_price_cents >= 0),
  excess_price_cents    bigint not null default 0 check (excess_price_cents >= 0),
  -- Nulos = usa o preço de reposição do produto.
  loss_price_cents      bigint check (loss_price_cents is null or loss_price_cents >= 0),
  damage_price_cents    bigint check (damage_price_cents is null or damage_price_cents >= 0),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (contract_id, product_id),
  foreign key (organization_id, contract_id) references public.contracts (organization_id, id) on delete restrict,
  foreign key (organization_id, product_id) references public.products (organization_id, id) on delete restrict
);
create index contract_items_org_idx on public.contract_items (organization_id);
create index contract_items_product_idx on public.contract_items (product_id);
create trigger contract_items_set_updated_at before update on public.contract_items
  for each row execute function app.set_updated_at();

-- Revisões imutáveis (fotografia completa do contrato após cada alteração).
create table public.contract_revisions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  contract_id      uuid not null,
  revision         integer not null,
  change_type      text not null check (change_type ~ '^[A-Z_]+$'),
  reason           text check (reason is null or length(reason) <= 500),
  snapshot         jsonb not null,
  actor_type       text not null check (actor_type in ('USER', 'INTEGRATION', 'SYSTEM')),
  actor_id         uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (contract_id, revision, change_type),
  foreign key (organization_id, contract_id) references public.contracts (organization_id, id) on delete restrict
);
create index contract_revisions_contract_idx on public.contract_revisions (contract_id, created_at);
create index contract_revisions_org_idx on public.contract_revisions (organization_id);
create trigger contract_revisions_append_only before update or delete on public.contract_revisions
  for each row execute function app.prevent_mutation();

-- Vínculo previsto na Fase 4 (orders.contract_id).
alter table public.orders
  add constraint orders_contract_fk foreign key (organization_id, contract_id) references public.contracts (organization_id, id) on delete restrict;
create index orders_contract_idx on public.orders (contract_id) where contract_id is not null;

-- -----------------------------------------------------------------------------
-- RLS + GRANTs
-- -----------------------------------------------------------------------------
alter table public.contract_counters  enable row level security;
alter table public.contracts          enable row level security;
alter table public.contract_items     enable row level security;
alter table public.contract_revisions enable row level security;

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on public.contract_counters, public.contracts, public.contract_items, public.contract_revisions from %I', r);
    end if;
  end loop;
end
$$;

grant select, insert, update on public.contracts to app_user;
grant select, insert, update, delete on public.contract_items to app_user;
grant select, insert on public.contract_revisions to app_user;

-- Equipe com contract.read; cliente vê os próprios contratos (menos rascunhos).
create policy contracts_select on public.contracts for select to app_user
  using (
    organization_id = (select app.current_org_id())
    and (
      (select app.has_permission('contract.read'))
      or ((select app.has_permission('portal.access')) and status <> 'DRAFT' and status <> 'CANCELLED'
          and customer_id = any (coalesce((select app.current_customer_ids()), '{}'::uuid[])))
    )
  );
create policy contracts_insert on public.contracts for insert to app_user
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('contract.manage')));
create policy contracts_update on public.contracts for update to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('contract.manage')))
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('contract.manage')));

create policy contract_items_select on public.contract_items for select to app_user
  using (organization_id = (select app.current_org_id()) and exists (select 1 from public.contracts c where c.id = contract_items.contract_id));
create policy contract_items_write on public.contract_items for all to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('contract.manage')))
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('contract.manage')));

create policy contract_revisions_select on public.contract_revisions for select to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('contract.read')));
create policy contract_revisions_insert on public.contract_revisions for insert to app_user
  with check (
    organization_id = (select app.current_org_id()) and (select app.has_permission('contract.manage'))
    and actor_type = (select app.current_actor_type()) and actor_id is not distinct from (select app.current_actor_id())
  );

-- Preço de perda/dano do contrato vigente para a resolução de ocorrências.
-- Independe de quem resolve enxergar contratos (o valor cobrado não pode
-- variar conforme a permissão de quem clica).
create or replace function app.contract_loss_damage_price(p_customer uuid, p_product uuid)
returns table (loss_price_cents bigint, damage_price_cents bigint, contract_id uuid)
language sql stable security definer set search_path = ''
as $$
  select ci.loss_price_cents, ci.damage_price_cents, c.id
    from public.contracts c
    join public.contract_items ci on ci.contract_id = c.id and ci.product_id = p_product
   where c.organization_id = app.current_org_id() and c.customer_id = p_customer and c.status in ('ACTIVE', 'SUSPENDED')
     and (app.has_permission('incident.manage') or app.has_permission('contract.read'))
   limit 1
$$;
revoke all on function app.contract_loss_damage_price(uuid, uuid) from public;
grant execute on function app.contract_loss_damage_price(uuid, uuid) to app_user;
