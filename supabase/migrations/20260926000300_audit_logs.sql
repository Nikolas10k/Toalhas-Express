-- =============================================================================
-- Fase 1 — Trilha de auditoria append-only.
-- =============================================================================

create table public.audit_logs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid references public.organizations (id) on delete restrict,
  actor_type       text not null check (actor_type in ('USER', 'INTEGRATION', 'SYSTEM', 'WEBHOOK', 'ANONYMOUS')),
  actor_id         uuid,
  action           text not null check (action ~ '^[a-z_]+(\.[a-z_]+)+$'),
  entity_type      text not null,
  entity_id        text,
  before           jsonb,
  after            jsonb,
  metadata         jsonb not null default '{}'::jsonb,
  ip               inet,
  user_agent       text check (user_agent is null or length(user_agent) <= 512),
  request_id       text,
  correlation_id   text,
  created_at       timestamptz not null default now(),
  -- Mantido por convenção (toda tabela tem updated_at); nunca muda.
  updated_at       timestamptz not null default now()
);
create index audit_logs_org_created_idx on public.audit_logs (organization_id, created_at desc, id desc);
create index audit_logs_entity_idx on public.audit_logs (organization_id, entity_type, entity_id);
create index audit_logs_actor_idx on public.audit_logs (organization_id, actor_id);
create index audit_logs_action_idx on public.audit_logs (organization_id, action);
create index audit_logs_correlation_idx on public.audit_logs (correlation_id);

create trigger audit_logs_append_only before update or delete on public.audit_logs
  for each row execute function app.prevent_mutation();
create trigger audit_logs_no_truncate before truncate on public.audit_logs
  for each statement execute function app.prevent_mutation();
