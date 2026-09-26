-- =============================================================================
-- Fase 5 — Motoristas, veículos, rotas e paradas.
--
-- Rota: PLANNED → IN_PROGRESS → COMPLETED | CANCELLED.
-- Parada: PENDING, ON_THE_WAY, ARRIVED, IN_SERVICE, COMPLETED, FAILED, SKIPPED, RESCHEDULED.
-- O motorista enxerga só as próprias rotas (e, nelas, o necessário para
-- operar: cliente, endereço, telefone, observações e quantidades).
-- =============================================================================

create table public.vehicles (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete restrict,
  -- Placa normalizada (antiga AAA9999 ou Mercosul AAA9A99), sem hífen.
  plate            text not null check (plate ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$'),
  model            text not null check (length(btrim(model)) between 2 and 100),
  -- Capacidade em toalhas (unidades) por viagem.
  capacity         integer not null check (capacity between 1 and 100000),
  status           text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE', 'MAINTENANCE')),
  notes            text check (notes is null or length(notes) <= 1000),
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, plate),
  unique (organization_id, id)
);
create index vehicles_org_status_idx on public.vehicles (organization_id, status);
create trigger vehicles_set_updated_at before update on public.vehicles
  for each row execute function app.set_updated_at();
create trigger vehicles_no_delete before delete on public.vehicles
  for each row execute function app.prevent_mutation();

create table public.drivers (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete restrict,
  full_name           text not null check (length(btrim(full_name)) between 2 and 150),
  document            text check (document is null or document ~ '^[0-9]{11}$'),
  phone               text check (phone is null or phone ~ '^\+55[0-9]{10,11}$'),
  -- Usuário que acessa o app do motorista (opcional até o convite ser aceito).
  user_id             uuid references public.profiles (id) on delete restrict,
  default_vehicle_id  uuid,
  status              text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE', 'ON_LEAVE')),
  notes               text check (notes is null or length(notes) <= 1000),
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, default_vehicle_id) references public.vehicles (organization_id, id) on delete restrict
);
create unique index drivers_org_document_uidx on public.drivers (organization_id, document) where document is not null;
create unique index drivers_org_user_uidx on public.drivers (organization_id, user_id) where user_id is not null;
create index drivers_org_status_idx on public.drivers (organization_id, status);
create index drivers_user_idx on public.drivers (user_id);
create index drivers_default_vehicle_idx on public.drivers (default_vehicle_id);
create trigger drivers_set_updated_at before update on public.drivers
  for each row execute function app.set_updated_at();
create trigger drivers_no_delete before delete on public.drivers
  for each row execute function app.prevent_mutation();

create table public.routes (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete restrict,
  route_date        date not null,
  driver_id         uuid not null,
  vehicle_id        uuid not null,
  status            text not null default 'PLANNED' check (status in ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  -- Estimativas da última otimização (Google Routes). Nulas quando a ordem é manual.
  distance_meters   integer check (distance_meters is null or distance_meters >= 0),
  duration_seconds  integer check (duration_seconds is null or duration_seconds >= 0),
  ordering          text not null default 'MANUAL' check (ordering in ('MANUAL', 'OPTIMIZED')),
  optimized_at      timestamptz,
  notes             text check (notes is null or length(notes) <= 1000),
  status_reason     text check (status_reason is null or length(status_reason) <= 500),
  started_at        timestamptz,
  completed_at      timestamptz,
  cancelled_at      timestamptz,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, driver_id) references public.drivers (organization_id, id) on delete restrict,
  foreign key (organization_id, vehicle_id) references public.vehicles (organization_id, id) on delete restrict
);
-- Um motorista não tem duas rotas abertas no mesmo dia.
create unique index routes_driver_open_uidx on public.routes (driver_id, route_date) where status in ('PLANNED', 'IN_PROGRESS');
create index routes_org_date_idx on public.routes (organization_id, route_date desc, status);
create index routes_driver_idx on public.routes (driver_id, route_date desc);
create index routes_vehicle_idx on public.routes (vehicle_id);
create trigger routes_set_updated_at before update on public.routes
  for each row execute function app.set_updated_at();
create trigger routes_no_delete before delete on public.routes
  for each row execute function app.prevent_mutation();

create table public.route_stops (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  route_id          uuid not null,
  order_id          uuid not null,
  customer_id       uuid not null,
  sequence          integer not null check (sequence between 1 and 500),
  status            text not null default 'PENDING'
                    check (status in ('PENDING', 'ON_THE_WAY', 'ARRIVED', 'IN_SERVICE', 'COMPLETED', 'FAILED', 'SKIPPED', 'RESCHEDULED')),
  latitude          numeric(9, 6),
  longitude         numeric(9, 6),
  status_reason     text check (status_reason is null or length(status_reason) <= 500),
  on_the_way_at     timestamptz,
  arrived_at        timestamptz,
  completed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organization_id, id),
  unique (route_id, order_id),
  -- Reordenação troca várias sequências na mesma transação.
  constraint route_stops_sequence_key unique (route_id, sequence) deferrable initially deferred,
  foreign key (organization_id, route_id) references public.routes (organization_id, id) on delete restrict,
  foreign key (organization_id, order_id) references public.orders (organization_id, id) on delete restrict,
  foreign key (organization_id, customer_id) references public.customers (organization_id, id) on delete restrict
);
create index route_stops_order_idx on public.route_stops (order_id);
create index route_stops_customer_idx on public.route_stops (customer_id);
create index route_stops_org_idx on public.route_stops (organization_id);
create trigger route_stops_set_updated_at before update on public.route_stops
  for each row execute function app.set_updated_at();

-- Linha do tempo da rota e das paradas (append-only).
create table public.route_events (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  route_id         uuid not null,
  route_stop_id    uuid,
  event_type       text not null check (event_type ~ '^[A-Z_]+$'),
  from_status      text,
  to_status        text,
  reason           text check (reason is null or length(reason) <= 500),
  metadata         jsonb not null default '{}'::jsonb,
  latitude         numeric(9, 6),
  longitude        numeric(9, 6),
  actor_type       text not null check (actor_type in ('USER', 'INTEGRATION', 'SYSTEM')),
  actor_id         uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (organization_id, route_id) references public.routes (organization_id, id) on delete restrict,
  foreign key (organization_id, route_stop_id) references public.route_stops (organization_id, id) on delete restrict
);
create index route_events_route_idx on public.route_events (route_id, created_at);
create index route_events_stop_idx on public.route_events (route_stop_id);
create index route_events_org_idx on public.route_events (organization_id);
create trigger route_events_append_only before update or delete on public.route_events
  for each row execute function app.prevent_mutation();

-- Vínculos que as fases anteriores deixaram preparados.
alter table public.orders
  add constraint orders_route_fk foreign key (organization_id, route_id) references public.routes (organization_id, id) on delete restrict,
  add constraint orders_driver_fk foreign key (organization_id, driver_id) references public.drivers (organization_id, id) on delete restrict;
alter table public.towel_movements
  add constraint towel_movements_route_fk foreign key (organization_id, route_id) references public.routes (organization_id, id) on delete restrict,
  add constraint towel_movements_route_stop_fk foreign key (organization_id, route_stop_id) references public.route_stops (organization_id, id) on delete restrict,
  add constraint towel_movements_driver_fk foreign key (organization_id, driver_id) references public.drivers (organization_id, id) on delete restrict;
create index towel_movements_route_stop_idx on public.towel_movements (route_stop_id) where route_stop_id is not null;
create index towel_movements_driver_idx on public.towel_movements (driver_id) where driver_id is not null;

-- -----------------------------------------------------------------------------
-- Helpers de RLS do motorista (SECURITY DEFINER: evitam recursão entre policies)
-- -----------------------------------------------------------------------------
-- Motorista (cadastro) do usuário atual na org ativa. Inativo perde o acesso.
create or replace function app.current_driver_id() returns uuid
language sql stable security definer set search_path = ''
as $$
  select d.id from public.drivers d
   where app.current_actor_type() = 'USER'
     and d.user_id = app.current_user_id()
     and d.organization_id = app.current_org_id()
     and d.status <> 'INACTIVE'
   limit 1
$$;

-- Pedido está numa rota do motorista atual.
create or replace function app.driver_can_see_order(p_order uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.has_permission('driver_app.access') and exists (
    select 1 from public.orders o join public.routes r on r.id = o.route_id
     where o.id = p_order and r.driver_id = app.current_driver_id()
  )
$$;

-- Cliente tem parada numa rota ABERTA do motorista (dados pessoais só enquanto necessários).
create or replace function app.driver_can_see_customer(p_customer uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.has_permission('driver_app.access') and exists (
    select 1 from public.route_stops s join public.routes r on r.id = s.route_id
     where s.customer_id = p_customer and r.driver_id = app.current_driver_id()
       and r.status in ('PLANNED', 'IN_PROGRESS')
  )
$$;

revoke all on function app.current_driver_id(), app.driver_can_see_order(uuid), app.driver_can_see_customer(uuid) from public;
grant execute on function app.current_driver_id(), app.driver_can_see_order(uuid), app.driver_can_see_customer(uuid) to app_user;

-- -----------------------------------------------------------------------------
-- RLS + GRANTs
-- -----------------------------------------------------------------------------
alter table public.vehicles     enable row level security;
alter table public.drivers      enable row level security;
alter table public.routes       enable row level security;
alter table public.route_stops  enable row level security;
alter table public.route_events enable row level security;

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on public.vehicles, public.drivers, public.routes, public.route_stops, public.route_events from %I', r);
    end if;
  end loop;
end
$$;

grant select, insert, update on public.vehicles, public.drivers, public.routes, public.route_stops to app_user;
-- Parada só é removida de rota ainda planejada (policy abaixo).
grant delete on public.route_stops to app_user;
grant select, insert on public.route_events to app_user;

create policy vehicles_select on public.vehicles for select to app_user
  using (
    organization_id = (select app.current_org_id())
    and ((select app.has_permission('route.read')) or (select app.has_permission('vehicle.manage')) or (select app.has_permission('driver_app.access')))
  );
create policy vehicles_insert on public.vehicles for insert to app_user
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('vehicle.manage')));
create policy vehicles_update on public.vehicles for update to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('vehicle.manage')))
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('vehicle.manage')));

create policy drivers_select on public.drivers for select to app_user
  using (
    organization_id = (select app.current_org_id())
    and (
      (select app.has_permission('route.read')) or (select app.has_permission('driver.manage'))
      or ((select app.has_permission('driver_app.access')) and user_id = (select app.current_user_id()))
    )
  );
create policy drivers_insert on public.drivers for insert to app_user
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('driver.manage')));
create policy drivers_update on public.drivers for update to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('driver.manage')))
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('driver.manage')));

create policy routes_select on public.routes for select to app_user
  using (
    organization_id = (select app.current_org_id())
    and (
      (select app.has_permission('route.read'))
      or ((select app.has_permission('driver_app.access')) and driver_id = (select app.current_driver_id()))
    )
  );
create policy routes_insert on public.routes for insert to app_user
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('route.manage')));
-- Motorista altera só a própria rota (o service limita a iniciar/finalizar).
create policy routes_update on public.routes for update to app_user
  using (
    organization_id = (select app.current_org_id())
    and (
      (select app.has_permission('route.manage'))
      or ((select app.has_permission('driver_app.access')) and driver_id = (select app.current_driver_id()))
    )
  )
  with check (
    organization_id = (select app.current_org_id())
    and (
      (select app.has_permission('route.manage'))
      or ((select app.has_permission('driver_app.access')) and driver_id = (select app.current_driver_id()))
    )
  );

create policy route_stops_select on public.route_stops for select to app_user
  using (organization_id = (select app.current_org_id()) and exists (select 1 from public.routes r where r.id = route_stops.route_id));
create policy route_stops_insert on public.route_stops for insert to app_user
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('route.manage')));
create policy route_stops_update on public.route_stops for update to app_user
  using (organization_id = (select app.current_org_id()) and exists (select 1 from public.routes r where r.id = route_stops.route_id))
  with check (organization_id = (select app.current_org_id()) and exists (select 1 from public.routes r where r.id = route_stops.route_id));
create policy route_stops_delete on public.route_stops for delete to app_user
  using (
    organization_id = (select app.current_org_id())
    and (select app.has_permission('route.manage'))
    and exists (select 1 from public.routes r where r.id = route_stops.route_id and r.status = 'PLANNED')
  );

create policy route_events_select on public.route_events for select to app_user
  using (organization_id = (select app.current_org_id()) and exists (select 1 from public.routes r where r.id = route_events.route_id));
create policy route_events_insert on public.route_events for insert to app_user
  with check (
    organization_id = (select app.current_org_id())
    and actor_type = (select app.current_actor_type())
    and actor_id is not distinct from (select app.current_actor_id())
    and exists (select 1 from public.routes r where r.id = route_events.route_id)
  );

-- Motorista: pedidos das próprias rotas (itens e histórico seguem o pedido),
-- clientes das rotas abertas e movimentos desses pedidos. Nada financeiro.
alter policy orders_select on public.orders
  using (
    organization_id = (select app.current_org_id())
    and (
      app.can_see_customer_record(customer_id)
      or ((select app.current_actor_type()) = 'INTEGRATION' and created_by = (select app.current_integration_token_id()))
      or app.driver_can_see_order(id)
    )
  );
alter policy orders_update on public.orders
  using (
    organization_id = (select app.current_org_id())
    and (
      (select app.has_permission('order.update')) or (select app.has_permission('order.cancel'))
      or ((select app.has_permission('portal.access')) and customer_id = any (coalesce((select app.current_customer_ids()), '{}'::uuid[])))
      or app.driver_can_see_order(id)
    )
  );
alter policy customers_select on public.customers
  using (
    organization_id = (select app.current_org_id())
    and (
      (select app.has_permission('customer.read'))
      or ((select app.has_permission('portal.access')) and id = any (coalesce((select app.current_customer_ids()), '{}'::uuid[])))
      or app.driver_can_see_customer(id)
    )
  );
alter policy towel_movements_select on public.towel_movements
  using (
    organization_id = (select app.current_org_id())
    and (
      (select app.has_permission('inventory.read'))
      or ((select app.has_permission('portal.access')) and customer_id = any (coalesce((select app.current_customer_ids()), '{}'::uuid[])))
      or (order_id is not null and app.driver_can_see_order(order_id))
    )
  );

-- Base de saída das rotas (origem da otimização): settings.routes.depot.
-- Quem planeja rotas (route.manage) altera SÓ este campo; o resto das
-- configurações continua exigindo organization.manage.
create or replace function app.set_route_depot(p_depot jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not app.has_permission('route.manage') then
    raise exception 'Sem permissão para alterar a base de saída' using errcode = '42501';
  end if;
  if jsonb_typeof(p_depot) <> 'object'
     or jsonb_typeof(p_depot -> 'latitude') <> 'number' or jsonb_typeof(p_depot -> 'longitude') <> 'number'
     or jsonb_typeof(p_depot -> 'name') <> 'string'
     or (p_depot ->> 'latitude')::numeric not between -90 and 90
     or (p_depot ->> 'longitude')::numeric not between -180 and 180
     or length(p_depot ->> 'name') > 100 then
    raise exception 'Base de saída inválida' using errcode = '22023';
  end if;
  update public.organizations
     set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{routes}',
                              coalesce(settings -> 'routes', '{}'::jsonb) || jsonb_build_object('depot',
                                jsonb_build_object('name', p_depot -> 'name', 'latitude', p_depot -> 'latitude', 'longitude', p_depot -> 'longitude')), true)
   where id = app.current_org_id();
end
$$;
revoke all on function app.set_route_depot(jsonb) from public;
grant execute on function app.set_route_depot(jsonb) to app_user;

update public.organizations
   set settings = jsonb_build_object('routes', jsonb_build_object('depot', null)) || settings
 where not (settings ? 'routes');
