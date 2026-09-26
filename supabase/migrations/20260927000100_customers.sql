-- =============================================================================
-- Fase 2 — Clientes: cadastro, vínculo com usuários do portal, importação CSV
-- e geocoding. Status: pending | active | suspended | inactive.
-- =============================================================================

create table public.customers (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete restrict,
  person_type         text not null check (person_type in ('PF', 'PJ')),
  legal_name          text not null check (length(btrim(legal_name)) between 2 and 200),
  trade_name          text check (trade_name is null or length(trade_name) <= 200),
  -- CPF (11 dígitos) ou CNPJ (14, alfanumérico desde 2026). Nulo só após anonimização.
  document            text check (document is null or document ~ '^[0-9]{11}$|^[0-9A-Z]{12}[0-9]{2}$'),
  contact_name        text check (contact_name is null or length(contact_name) <= 150),
  phone               text check (phone is null or phone ~ '^\+55[0-9]{10,11}$'),
  whatsapp            text check (whatsapp is null or whatsapp ~ '^\+55[0-9]{10,11}$'),
  email               text check (email is null or (length(email) <= 254 and email = lower(email) and email like '%_@_%')),
  postal_code         text check (postal_code is null or postal_code ~ '^[0-9]{8}$'),
  street              text check (street is null or length(street) <= 200),
  number              text check (number is null or length(number) <= 20),
  complement          text check (complement is null or length(complement) <= 100),
  district            text check (district is null or length(district) <= 100),
  city                text check (city is null or length(city) <= 100),
  state               text check (state is null or state ~ '^[A-Z]{2}$'),
  country             text not null default 'BR',
  latitude            numeric(9, 6) check (latitude is null or latitude between -90 and 90),
  longitude           numeric(9, 6) check (longitude is null or longitude between -180 and 180),
  place_id            text check (place_id is null or length(place_id) <= 512),
  formatted_address   text,
  geocode_status      text not null default 'PENDING'
                      check (geocode_status in ('PENDING', 'OK', 'PARTIAL', 'NOT_FOUND', 'FAILED', 'MANUAL', 'SKIPPED')),
  geocoded_at         timestamptz,
  preferred_channel   text not null default 'WHATSAPP' check (preferred_channel in ('WHATSAPP', 'EMAIL', 'PHONE', 'NONE')),
  whatsapp_opt_in     boolean not null default false,
  email_opt_in        boolean not null default false,
  consent_updated_at  timestamptz,
  consent_source      text check (consent_source is null or consent_source in ('ADMIN', 'SELF_SIGNUP', 'PORTAL', 'IMPORT', 'INTEGRATION')),
  notes               text check (notes is null or length(notes) <= 2000),
  status              text not null default 'pending' check (status in ('pending', 'active', 'suspended', 'inactive')),
  status_reason       text check (status_reason is null or length(status_reason) <= 500),
  status_changed_at   timestamptz,
  approved_at         timestamptz,
  approved_by         uuid references public.profiles (id) on delete restrict,
  source              text not null default 'ADMIN' check (source in ('ADMIN', 'SELF_SIGNUP', 'IMPORT', 'INTEGRATION')),
  import_id           uuid,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  anonymized_at       timestamptz,
  unique (organization_id, id)
);
create unique index customers_org_document_uidx on public.customers (organization_id, document) where document is not null;
create index customers_org_status_idx on public.customers (organization_id, status, created_at desc);
create index customers_org_created_idx on public.customers (organization_id, created_at desc, id desc);
create index customers_org_name_idx on public.customers (organization_id, lower(legal_name));
create index customers_org_trade_name_idx on public.customers (organization_id, lower(trade_name));
create index customers_org_phone_idx on public.customers (organization_id, phone);
create index customers_org_whatsapp_idx on public.customers (organization_id, whatsapp);
create index customers_geocode_idx on public.customers (organization_id, geocode_status) where geocode_status in ('PENDING', 'FAILED');
create index customers_place_id_idx on public.customers (place_id);
create index customers_import_id_idx on public.customers (import_id);
create trigger customers_set_updated_at before update on public.customers
  for each row execute function app.set_updated_at();
create trigger customers_no_delete before delete on public.customers
  for each row execute function app.prevent_mutation();

-- Usuários (auth) que acessam o portal em nome do cliente.
create table public.customer_users (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  customer_id      uuid not null,
  user_id          uuid not null references public.profiles (id) on delete restrict,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, user_id),
  unique (customer_id, user_id),
  foreign key (organization_id, customer_id) references public.customers (organization_id, id) on delete restrict
);
create index customer_users_customer_id_idx on public.customer_users (customer_id);
create index customer_users_user_id_idx on public.customer_users (user_id);
create trigger customer_users_set_updated_at before update on public.customer_users
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Importação CSV: upload → preview → mapeamento → validação → duplicados →
-- escolha → commit → relatório. Nada inválido é importado em silêncio.
-- -----------------------------------------------------------------------------
create table public.customer_imports (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete restrict,
  status              text not null default 'UPLOADED'
                      check (status in ('UPLOADED', 'VALIDATED', 'COMMITTING', 'COMMITTED', 'CANCELLED')),
  file_name           text not null check (length(file_name) <= 255),
  file_sha256         text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  delimiter           text not null check (delimiter in (',', ';', E'\t')),
  headers             jsonb not null,
  row_count           integer not null check (row_count between 0 and 5000),
  mapping             jsonb,
  duplicate_strategy  text check (duplicate_strategy in ('ONLY_NEW', 'UPDATE_DUPLICATES', 'ONLY_UPDATE')),
  summary             jsonb not null default '{}'::jsonb,
  created_by          uuid not null,
  validated_at        timestamptz,
  committed_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (organization_id, id)
);
create index customer_imports_org_created_idx on public.customer_imports (organization_id, created_at desc);
create index customer_imports_status_idx on public.customer_imports (organization_id, status);
create trigger customer_imports_set_updated_at before update on public.customer_imports
  for each row execute function app.set_updated_at();

alter table public.customers
  add constraint customers_import_fk foreign key (organization_id, import_id)
  references public.customer_imports (organization_id, id) on delete restrict;

create table public.customer_import_rows (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null,
  import_id              uuid not null,
  row_number             integer not null check (row_number >= 1),
  raw                    jsonb not null,
  normalized             jsonb,
  errors                 jsonb not null default '[]'::jsonb,
  duplicate_customer_id  uuid,
  duplicate_in_file_of   integer,
  action                 text check (action in ('INSERT', 'UPDATE', 'SKIP', 'REJECT')),
  result                 text check (result in ('IMPORTED', 'UPDATED', 'SKIPPED', 'REJECTED')),
  result_customer_id     uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (import_id, row_number),
  foreign key (organization_id, import_id) references public.customer_imports (organization_id, id) on delete restrict
);
create index customer_import_rows_org_idx on public.customer_import_rows (organization_id);
create index customer_import_rows_action_idx on public.customer_import_rows (import_id, action);
create trigger customer_import_rows_set_updated_at before update on public.customer_import_rows
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Helpers de RLS
-- -----------------------------------------------------------------------------
-- Clientes vinculados ao usuário atual na org ativa (portal).
create or replace function app.current_customer_ids() returns uuid[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(cu.customer_id), '{}')
  from public.customer_users cu
  join public.customers c on c.id = cu.customer_id
  where app.current_actor_type() = 'USER'
    and cu.user_id = app.current_user_id()
    and cu.organization_id = app.current_org_id()
    and c.deleted_at is null
$$;
revoke all on function app.current_customer_ids() from public;
grant execute on function app.current_customer_ids() to app_user;

-- -----------------------------------------------------------------------------
-- RLS + GRANTs
-- -----------------------------------------------------------------------------
alter table public.customers            enable row level security;
alter table public.customer_users       enable row level security;
alter table public.customer_imports     enable row level security;
alter table public.customer_import_rows enable row level security;

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on public.customers, public.customer_users, public.customer_imports, public.customer_import_rows from %I', r);
    end if;
  end loop;
end
$$;

grant select, insert, update on public.customers to app_user;
grant select, insert on public.customer_users to app_user;
grant select, insert, update on public.customer_imports, public.customer_import_rows to app_user;
grant update (settings) on public.organizations to app_user;

-- Equipe (customer.read) vê todos os clientes da org; o cliente vê só o(s) seu(s).
create policy customers_select on public.customers for select to app_user
  using (
    organization_id = (select app.current_org_id())
    and (
      (select app.has_permission('customer.read'))
      or ((select app.has_permission('portal.access')) and id = any (coalesce((select app.current_customer_ids()), '{}'::uuid[])))
    )
  );
create policy customers_insert on public.customers for insert to app_user
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('customer.create')));
-- Equipe altera com customer.update; cliente altera o próprio cadastro (o
-- service restringe as colunas permitidas: contato e preferências).
create policy customers_update on public.customers for update to app_user
  using (
    organization_id = (select app.current_org_id())
    and (
      (select app.has_permission('customer.update'))
      or ((select app.has_permission('portal.access')) and id = any (coalesce((select app.current_customer_ids()), '{}'::uuid[])))
    )
  )
  with check (
    organization_id = (select app.current_org_id())
    and (
      (select app.has_permission('customer.update'))
      or ((select app.has_permission('portal.access')) and id = any (coalesce((select app.current_customer_ids()), '{}'::uuid[])))
    )
  );

create policy customer_users_select on public.customer_users for select to app_user
  using (
    organization_id = (select app.current_org_id())
    and ((select app.has_permission('customer.read')) or user_id = (select app.current_user_id()))
  );
create policy customer_users_insert on public.customer_users for insert to app_user
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('users.manage')));

create policy customer_imports_all on public.customer_imports for all to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('customer.import')))
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('customer.import')));
create policy customer_import_rows_all on public.customer_import_rows for all to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('customer.import')))
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('customer.import')));

create policy organizations_update_settings on public.organizations for update to app_user
  using (id = (select app.current_org_id()) and (select app.has_permission('organization.manage')))
  with check (id = (select app.current_org_id()) and (select app.has_permission('organization.manage')));

-- Configurações padrão de clientes nas organizações existentes.
update public.organizations
   set settings = jsonb_build_object('customers', jsonb_build_object('selfSignupEnabled', false, 'requireApproval', true)) || settings
 where not (settings ? 'customers');
