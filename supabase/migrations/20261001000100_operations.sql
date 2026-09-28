-- =============================================================================
-- Fase 6 — Entrega, coleta, prova da operação, ocorrências, dano e perda.
--
-- * stop_operations / stop_operation_items: registro imutável do atendimento
--   de cada parada (previsto × carregado × entregue; esperado × coletado).
-- * incidents: ocorrências OPEN → UNDER_REVIEW → RESOLVED | CANCELLED.
-- * billable_events: fato cobrável (perda/dano) gerado UMA vez por ocorrência;
--   receivable/charge chegam na Fase 9.
-- * attachments: fotos em bucket privado, acesso só por signed URL.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Anexos (fotos de prova e de ocorrências)
-- -----------------------------------------------------------------------------
create table public.attachments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete restrict,
  bucket           text not null check (bucket ~ '^[a-z0-9-]{3,63}$'),
  path             text not null check (length(path) between 10 and 300 and path !~ '\.\.'),
  content_type     text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes       integer not null check (size_bytes between 1 and 5242880),
  sha256           text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  -- Vínculo definido quando o anexo é usado (prova da parada ou ocorrência).
  entity_type      text check (entity_type is null or entity_type in ('stop_operation', 'incident')),
  entity_id        uuid,
  uploaded_by      uuid not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (bucket, path),
  check ((entity_type is null) = (entity_id is null))
);
create index attachments_entity_idx on public.attachments (entity_type, entity_id);
create index attachments_org_idx on public.attachments (organization_id, created_at desc);
create index attachments_uploader_idx on public.attachments (uploaded_by) where entity_id is null;
create trigger attachments_set_updated_at before update on public.attachments
  for each row execute function app.set_updated_at();
create trigger attachments_no_delete before delete on public.attachments
  for each row execute function app.prevent_mutation();

-- Vínculo é definitivo: anexo usado não muda de dono nem de registro.
create or replace function app.attachments_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.bucket <> old.bucket or new.path <> old.path or new.sha256 <> old.sha256 or new.uploaded_by <> old.uploaded_by
     or new.organization_id <> old.organization_id
     or (old.entity_id is not null and (new.entity_id is distinct from old.entity_id or new.entity_type is distinct from old.entity_type)) then
    raise exception 'Anexo não pode ser alterado depois de vinculado' using errcode = 'P0001';
  end if;
  return new;
end
$$;
create trigger attachments_guard before update on public.attachments
  for each row execute function app.attachments_guard();

-- -----------------------------------------------------------------------------
-- Atendimento da parada
-- -----------------------------------------------------------------------------
create table public.stop_operations (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null,
  route_id             uuid not null,
  route_stop_id        uuid not null,
  order_id             uuid not null,
  customer_id          uuid not null,
  driver_id            uuid,
  recipient_name       text check (recipient_name is null or length(btrim(recipient_name)) between 2 and 150),
  notes                text check (notes is null or length(notes) <= 1000),
  latitude             numeric(9, 6),
  longitude            numeric(9, 6),
  accuracy_meters      integer check (accuracy_meters is null or accuracy_meters >= 0),
  geolocation_status   text not null check (geolocation_status in ('CAPTURED', 'UNAVAILABLE')),
  occurred_at          timestamptz not null default now(),
  actor_type           text not null check (actor_type in ('USER', 'INTEGRATION', 'SYSTEM')),
  actor_id             uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- Uma parada é atendida uma única vez (retry/duplo toque não duplica).
  unique (route_stop_id),
  unique (organization_id, id),
  foreign key (organization_id, route_id) references public.routes (organization_id, id) on delete restrict,
  foreign key (organization_id, route_stop_id) references public.route_stops (organization_id, id) on delete restrict,
  foreign key (organization_id, order_id) references public.orders (organization_id, id) on delete restrict,
  foreign key (organization_id, customer_id) references public.customers (organization_id, id) on delete restrict,
  foreign key (organization_id, driver_id) references public.drivers (organization_id, id) on delete restrict
);
create index stop_operations_org_date_idx on public.stop_operations (organization_id, occurred_at desc);
create index stop_operations_customer_idx on public.stop_operations (organization_id, customer_id, occurred_at desc);
create index stop_operations_route_idx on public.stop_operations (route_id);
create index stop_operations_order_idx on public.stop_operations (order_id);
create trigger stop_operations_append_only before update or delete on public.stop_operations
  for each row execute function app.prevent_mutation();

create table public.stop_operation_items (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null,
  operation_id              uuid not null,
  product_id                uuid not null,
  planned_delivery          integer not null default 0 check (planned_delivery >= 0),
  loaded                    integer not null default 0 check (loaded >= 0),
  delivered                 integer not null default 0 check (delivered >= 0),
  expected_collection       integer not null default 0 check (expected_collection >= 0),
  customer_balance_before   integer not null default 0 check (customer_balance_before >= 0),
  collected                 integer not null default 0 check (collected >= 0),
  damaged                   integer not null default 0 check (damaged >= 0),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  check (delivered <= loaded),
  check (collected <= customer_balance_before),
  check (damaged <= collected),
  unique (operation_id, product_id),
  foreign key (organization_id, operation_id) references public.stop_operations (organization_id, id) on delete restrict,
  foreign key (organization_id, product_id) references public.products (organization_id, id) on delete restrict
);
create index stop_operation_items_org_idx on public.stop_operation_items (organization_id);
create index stop_operation_items_product_idx on public.stop_operation_items (product_id);
create trigger stop_operation_items_append_only before update or delete on public.stop_operation_items
  for each row execute function app.prevent_mutation();

-- -----------------------------------------------------------------------------
-- Ocorrências
-- -----------------------------------------------------------------------------
create table public.incident_counters (
  organization_id  uuid primary key references public.organizations (id) on delete restrict,
  last_number      bigint not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create or replace function app.next_incident_number(p_org uuid) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare v bigint;
begin
  if p_org is distinct from app.current_org_id() then
    raise exception 'Organização inválida para numeração';
  end if;
  insert into public.incident_counters as c (organization_id, last_number) values (p_org, 1)
  on conflict (organization_id) do update set last_number = c.last_number + 1, updated_at = now()
  returning last_number into v;
  return v;
end
$$;
revoke all on function app.next_incident_number(uuid) from public;
grant execute on function app.next_incident_number(uuid) to app_user;

create table public.incidents (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id) on delete restrict,
  number                bigint not null,
  incident_type         text not null check (incident_type in ('NOT_RETURNED', 'IN_USE', 'DAMAGED', 'LOST', 'CUSTOMER_REFUSED',
                                                               'CUSTOMER_CLOSED', 'ADDRESS_PROBLEM', 'QUANTITY_DIVERGENCE', 'OTHER')),
  status                text not null default 'OPEN' check (status in ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'CANCELLED')),
  source                text not null check (source in ('DRIVER', 'STAFF', 'SYSTEM')),
  customer_id           uuid,
  order_id              uuid,
  route_id              uuid,
  route_stop_id         uuid,
  operation_id          uuid,
  product_id            uuid,
  quantity              integer not null default 0 check (quantity between 0 and 100000),
  description           text not null check (length(btrim(description)) between 3 and 2000),
  -- Contexto estruturado (ex.: divergência: etapa, esperado, realizado).
  details               jsonb not null default '{}'::jsonb,
  damage_class          text check (damage_class is null or damage_class in ('TORN', 'STAINED', 'BURNED', 'FRAYED', 'WORN')),
  decision              text check (decision is null or decision in ('NO_ACTION', 'RETURN_TO_LAUNDRY', 'RETURN_TO_STOCK', 'DISCARD',
                                                                     'CHARGE_CUSTOMER', 'REGISTER_LOSS')),
  charge_customer       boolean,
  charge_amount_cents   bigint check (charge_amount_cents is null or charge_amount_cents >= 0),
  assigned_to           uuid references public.profiles (id) on delete restrict,
  resolution            text check (resolution is null or length(resolution) <= 2000),
  resolved_at           timestamptz,
  resolved_by           uuid,
  reported_by           uuid,
  reporter_type         text not null check (reporter_type in ('USER', 'INTEGRATION', 'SYSTEM')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (organization_id, number),
  unique (organization_id, id),
  check ((status = 'RESOLVED') = (decision is not null)),
  foreign key (organization_id, customer_id) references public.customers (organization_id, id) on delete restrict,
  foreign key (organization_id, order_id) references public.orders (organization_id, id) on delete restrict,
  foreign key (organization_id, route_id) references public.routes (organization_id, id) on delete restrict,
  foreign key (organization_id, route_stop_id) references public.route_stops (organization_id, id) on delete restrict,
  foreign key (organization_id, operation_id) references public.stop_operations (organization_id, id) on delete restrict,
  foreign key (organization_id, product_id) references public.products (organization_id, id) on delete restrict
);
create index incidents_org_status_idx on public.incidents (organization_id, status, created_at desc);
create index incidents_org_type_idx on public.incidents (organization_id, incident_type, created_at desc);
create index incidents_customer_idx on public.incidents (organization_id, customer_id, created_at desc);
create index incidents_order_idx on public.incidents (order_id);
create index incidents_route_idx on public.incidents (route_id);
create index incidents_stop_idx on public.incidents (route_stop_id);
create index incidents_operation_idx on public.incidents (operation_id);
create index incidents_product_idx on public.incidents (product_id);
create trigger incidents_set_updated_at before update on public.incidents
  for each row execute function app.set_updated_at();
create trigger incidents_no_delete before delete on public.incidents
  for each row execute function app.prevent_mutation();

create table public.incident_events (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  incident_id      uuid not null,
  event_type       text not null check (event_type ~ '^[A-Z_]+$'),
  from_status      text,
  to_status        text,
  note             text check (note is null or length(note) <= 2000),
  metadata         jsonb not null default '{}'::jsonb,
  actor_type       text not null check (actor_type in ('USER', 'INTEGRATION', 'SYSTEM')),
  actor_id         uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (organization_id, incident_id) references public.incidents (organization_id, id) on delete restrict
);
create index incident_events_incident_idx on public.incident_events (incident_id, created_at);
create index incident_events_org_idx on public.incident_events (organization_id);
create trigger incident_events_append_only before update or delete on public.incident_events
  for each row execute function app.prevent_mutation();

-- -----------------------------------------------------------------------------
-- Fato cobrável (perda/dano). Valor calculado no servidor e imutável.
-- -----------------------------------------------------------------------------
create table public.billable_events (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete restrict,
  customer_id        uuid not null,
  source_type        text not null check (source_type in ('INCIDENT')),
  source_id          uuid not null,
  kind               text not null check (kind in ('LOSS', 'DAMAGE')),
  description        text not null check (length(description) between 3 and 500),
  product_id         uuid,
  quantity           integer not null check (quantity > 0),
  unit_price_cents   bigint not null check (unit_price_cents >= 0),
  amount_cents       bigint not null check (amount_cents >= 0),
  status             text not null default 'PENDING' check (status in ('PENDING', 'INVOICED', 'CANCELLED')),
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- A mesma ocorrência nunca gera duas cobranças.
  unique (organization_id, source_type, source_id),
  unique (organization_id, id),
  check (amount_cents = quantity * unit_price_cents),
  foreign key (organization_id, customer_id) references public.customers (organization_id, id) on delete restrict,
  foreign key (organization_id, product_id) references public.products (organization_id, id) on delete restrict
);
create index billable_events_customer_idx on public.billable_events (organization_id, customer_id, created_at desc);
create index billable_events_status_idx on public.billable_events (organization_id, status);
create index billable_events_product_idx on public.billable_events (product_id);
create trigger billable_events_set_updated_at before update on public.billable_events
  for each row execute function app.set_updated_at();
create trigger billable_events_no_delete before delete on public.billable_events
  for each row execute function app.prevent_mutation();

create or replace function app.billable_events_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.customer_id <> old.customer_id or new.source_type <> old.source_type or new.source_id <> old.source_id
     or new.kind <> old.kind or new.quantity <> old.quantity or new.unit_price_cents <> old.unit_price_cents
     or new.amount_cents <> old.amount_cents or new.product_id is distinct from old.product_id
     or new.organization_id <> old.organization_id then
    raise exception 'Valores de billable_events são imutáveis' using errcode = 'P0001';
  end if;
  return new;
end
$$;
create trigger billable_events_guard before update on public.billable_events
  for each row execute function app.billable_events_guard();

-- Saldo do cliente para quem opera a parada (motorista não lê stock_balances).
create or replace function app.customer_product_balance(p_customer uuid, p_product uuid) returns integer
language sql stable security definer set search_path = ''
as $$
  select case
    when app.has_permission('inventory.read') or app.driver_can_see_customer(p_customer) then
      coalesce((select b.quantity::int from public.stock_balances b
                 where b.organization_id = app.current_org_id() and b.product_id = p_product
                   and b.state = 'WITH_CUSTOMER' and b.customer_id = p_customer), 0)
    else null
  end
$$;
revoke all on function app.customer_product_balance(uuid, uuid) from public;
grant execute on function app.customer_product_balance(uuid, uuid) to app_user;

-- -----------------------------------------------------------------------------
-- RLS + GRANTs
-- -----------------------------------------------------------------------------
alter table public.attachments          enable row level security;
alter table public.stop_operations      enable row level security;
alter table public.stop_operation_items enable row level security;
alter table public.incident_counters    enable row level security;
alter table public.incidents            enable row level security;
alter table public.incident_events      enable row level security;
alter table public.billable_events      enable row level security;

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on public.attachments, public.stop_operations, public.stop_operation_items, public.incident_counters, '
                     'public.incidents, public.incident_events, public.billable_events from %I', r);
    end if;
  end loop;
end
$$;

grant select, insert on public.attachments to app_user;
grant update (entity_type, entity_id) on public.attachments to app_user;
grant select, insert on public.stop_operations, public.stop_operation_items, public.incident_events to app_user;
grant select, insert, update on public.incidents to app_user;
grant select, insert on public.billable_events to app_user;
grant update (status) on public.billable_events to app_user;

-- Anexos: quem enviou vê e vincula os próprios; equipe vê os de ocorrências/rotas.
create policy attachments_select on public.attachments for select to app_user
  using (
    organization_id = (select app.current_org_id())
    and (
      uploaded_by = (select app.current_user_id())
      or (entity_type = 'incident' and (select app.has_permission('incident.read')))
      or (entity_type = 'stop_operation' and (select app.has_permission('route.read')))
    )
  );
create policy attachments_insert on public.attachments for insert to app_user
  with check (
    organization_id = (select app.current_org_id())
    and uploaded_by = (select app.current_user_id())
    and entity_id is null
    and ((select app.has_permission('operation.execute')) or (select app.has_permission('incident.report')) or (select app.has_permission('incident.manage')))
  );
create policy attachments_update on public.attachments for update to app_user
  using (organization_id = (select app.current_org_id()) and uploaded_by = (select app.current_user_id()) and entity_id is null)
  with check (organization_id = (select app.current_org_id()) and uploaded_by = (select app.current_user_id()));

-- Atendimento: equipe (route.read), motorista da rota, cliente (as próprias entregas).
create policy stop_operations_select on public.stop_operations for select to app_user
  using (
    organization_id = (select app.current_org_id())
    and (
      (select app.has_permission('route.read'))
      or exists (select 1 from public.routes r where r.id = stop_operations.route_id)
      or ((select app.has_permission('portal.access')) and customer_id = any (coalesce((select app.current_customer_ids()), '{}'::uuid[])))
    )
  );
create policy stop_operations_insert on public.stop_operations for insert to app_user
  with check (
    organization_id = (select app.current_org_id())
    and (select app.has_permission('operation.execute'))
    and actor_type = (select app.current_actor_type())
    and actor_id is not distinct from (select app.current_actor_id())
    and exists (select 1 from public.routes r where r.id = stop_operations.route_id and r.status = 'IN_PROGRESS')
  );
create policy stop_operation_items_select on public.stop_operation_items for select to app_user
  using (organization_id = (select app.current_org_id()) and exists (select 1 from public.stop_operations o where o.id = stop_operation_items.operation_id));
create policy stop_operation_items_insert on public.stop_operation_items for insert to app_user
  with check (
    organization_id = (select app.current_org_id())
    and (select app.has_permission('operation.execute'))
    and exists (select 1 from public.stop_operations o where o.id = stop_operation_items.operation_id)
  );

-- Ocorrências: equipe com incident.read; quem reportou vê as próprias.
create policy incidents_select on public.incidents for select to app_user
  using (
    organization_id = (select app.current_org_id())
    and ((select app.has_permission('incident.read')) or reported_by = (select app.current_actor_id()))
  );
create policy incidents_insert on public.incidents for insert to app_user
  with check (
    organization_id = (select app.current_org_id())
    and ((select app.has_permission('incident.report')) or (select app.has_permission('incident.manage')))
    and reporter_type = (select app.current_actor_type())
    and reported_by is not distinct from (select app.current_actor_id())
  );
create policy incidents_update on public.incidents for update to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('incident.manage')))
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('incident.manage')));

create policy incident_events_select on public.incident_events for select to app_user
  using (organization_id = (select app.current_org_id()) and exists (select 1 from public.incidents i where i.id = incident_events.incident_id));
create policy incident_events_insert on public.incident_events for insert to app_user
  with check (
    organization_id = (select app.current_org_id())
    and actor_type = (select app.current_actor_type())
    and actor_id is not distinct from (select app.current_actor_id())
    and exists (select 1 from public.incidents i where i.id = incident_events.incident_id)
  );

-- Cobráveis: financeiro ou quem decide ocorrências. Motorista e cliente não veem.
create policy billable_events_select on public.billable_events for select to app_user
  using (
    organization_id = (select app.current_org_id())
    and ((select app.has_permission('finance.read')) or (select app.has_permission('incident.manage')))
  );
create policy billable_events_insert on public.billable_events for insert to app_user
  with check (
    organization_id = (select app.current_org_id())
    and (select app.has_permission('incident.manage'))
    and (select app.has_permission('finance.create_charge'))
  );
create policy billable_events_update on public.billable_events for update to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('finance.create_charge')))
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('finance.create_charge')));

-- Configuração: foto obrigatória na prova (padrão: não).
update public.organizations
   set settings = jsonb_build_object('operations', jsonb_build_object('requireProofPhoto', false)) || settings
 where not (settings ? 'operations');

-- Bucket privado para fotos (só no Supabase; testes locais não têm o schema storage).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage')
     and exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'storage' and c.relname = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('operation-proofs', 'operation-proofs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;
  end if;
end
$$;
