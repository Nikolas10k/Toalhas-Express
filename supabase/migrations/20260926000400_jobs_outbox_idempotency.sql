-- =============================================================================
-- Fase 1 — Fila de jobs, outbox transacional, chaves de idempotência e
-- rate limit compartilhado (serverless não tem memória entre instâncias).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Jobs: retry com backoff exponencial + jitter (calculado no domínio),
-- limite de tentativas e DEAD_LETTER.
-- -----------------------------------------------------------------------------
create table public.jobs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid references public.organizations (id) on delete restrict,
  type             text not null check (type ~ '^[a-z_]+(\.[a-z_]+)+$'),
  payload          jsonb not null default '{}'::jsonb,
  status           text not null default 'PENDING'
                   check (status in ('PENDING', 'RUNNING', 'SUCCEEDED', 'DEAD_LETTER', 'CANCELLED')),
  priority         smallint not null default 0,
  attempts         integer not null default 0 check (attempts >= 0),
  max_attempts     integer not null default 8 check (max_attempts between 1 and 50),
  next_run_at      timestamptz not null default now(),
  locked_at        timestamptz,
  locked_by        text,
  last_error       text,
  idempotency_key  text unique,
  correlation_id   text,
  completed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index jobs_runnable_idx on public.jobs (priority desc, next_run_at) where status = 'PENDING';
create index jobs_running_idx on public.jobs (locked_at) where status = 'RUNNING';
create index jobs_status_idx on public.jobs (status, updated_at);
create index jobs_organization_id_idx on public.jobs (organization_id);
create index jobs_type_idx on public.jobs (type);
create trigger jobs_set_updated_at before update on public.jobs
  for each row execute function app.set_updated_at();
create trigger jobs_no_delete before delete on public.jobs
  for each row execute function app.prevent_mutation();

-- Reserva atômica de jobs executáveis (inclui RUNNING com lock expirado —
-- worker que morreu no meio). FOR UPDATE SKIP LOCKED permite vários workers.
create or replace function app.claim_jobs(
  p_worker        text,
  p_limit         integer,
  p_lock_timeout  interval default interval '5 minutes',
  p_types         text[] default null
)
returns setof public.jobs
language sql
set search_path = ''
as $$
  with candidates as (
    select j.id
    from public.jobs j
    where ((j.status = 'PENDING' and j.next_run_at <= now())
           or (j.status = 'RUNNING' and j.locked_at < now() - p_lock_timeout))
      and (p_types is null or j.type = any (p_types))
    order by j.priority desc, j.next_run_at
    limit greatest(p_limit, 0)
    for update skip locked
  )
  update public.jobs j
     set status = 'RUNNING',
         locked_at = now(),
         locked_by = p_worker,
         attempts = j.attempts + 1
    from candidates c
   where j.id = c.id
  returning j.*
$$;
revoke all on function app.claim_jobs(text, integer, interval, text[]) from public;

-- -----------------------------------------------------------------------------
-- Outbox: gravado na MESMA transação da operação de negócio. Publicado depois
-- pelo worker (n8n via webhook HMAC e consumidores internos).
-- Conteúdo do evento é imutável; só os campos de entrega mudam.
-- -----------------------------------------------------------------------------
create table public.outbox_events (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete restrict,
  event_type       text not null check (event_type ~ '^[A-Z][A-Za-z]+$'),
  aggregate_type   text not null,
  aggregate_id     text not null,
  payload          jsonb not null default '{}'::jsonb,
  status           text not null default 'PENDING'
                   check (status in ('PENDING', 'PUBLISHING', 'PUBLISHED', 'DEAD_LETTER')),
  attempts         integer not null default 0 check (attempts >= 0),
  max_attempts     integer not null default 12 check (max_attempts between 1 and 100),
  next_attempt_at  timestamptz not null default now(),
  locked_at        timestamptz,
  published_at     timestamptz,
  last_error       text,
  idempotency_key  text not null unique,
  correlation_id   text,
  occurred_at      timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index outbox_events_pending_idx on public.outbox_events (next_attempt_at) where status = 'PENDING';
create index outbox_events_publishing_idx on public.outbox_events (locked_at) where status = 'PUBLISHING';
create index outbox_events_organization_id_idx on public.outbox_events (organization_id, created_at desc);
create index outbox_events_aggregate_idx on public.outbox_events (organization_id, aggregate_type, aggregate_id);
create index outbox_events_status_idx on public.outbox_events (status);
create trigger outbox_events_set_updated_at before update on public.outbox_events
  for each row execute function app.set_updated_at();

create or replace function app.outbox_guard_immutable() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'outbox_events não pode ser apagado' using errcode = 'P0001';
  end if;
  if new.id <> old.id
     or new.organization_id <> old.organization_id
     or new.event_type <> old.event_type
     or new.aggregate_type <> old.aggregate_type
     or new.aggregate_id <> old.aggregate_id
     or new.payload <> old.payload
     or new.idempotency_key <> old.idempotency_key
     or new.occurred_at <> old.occurred_at
     or new.created_at <> old.created_at then
    raise exception 'Conteúdo de outbox_events é imutável' using errcode = 'P0001';
  end if;
  return new;
end
$$;
create trigger outbox_events_guard before update or delete on public.outbox_events
  for each row execute function app.outbox_guard_immutable();
create trigger outbox_events_no_truncate before truncate on public.outbox_events
  for each statement execute function app.prevent_mutation();

create or replace function app.claim_outbox_events(
  p_limit         integer,
  p_lock_timeout  interval default interval '5 minutes'
)
returns setof public.outbox_events
language sql
set search_path = ''
as $$
  with candidates as (
    select e.id
    from public.outbox_events e
    where (e.status = 'PENDING' and e.next_attempt_at <= now())
       or (e.status = 'PUBLISHING' and e.locked_at < now() - p_lock_timeout)
    order by e.next_attempt_at, e.created_at
    limit greatest(p_limit, 0)
    for update skip locked
  )
  update public.outbox_events e
     set status = 'PUBLISHING',
         locked_at = now(),
         attempts = e.attempts + 1
    from candidates c
   where e.id = c.id
  returning e.*
$$;
revoke all on function app.claim_outbox_events(integer, interval) from public;

-- -----------------------------------------------------------------------------
-- Idempotência de comandos (duplo clique, retry do n8n, timeout do cliente).
-- A chave é gravada na mesma transação da operação: ou ambos persistem ou
-- nenhum. Requisição concorrente com a mesma chave bloqueia na PK e, após o
-- commit da primeira, recebe a resposta armazenada.
-- -----------------------------------------------------------------------------
create table public.idempotency_keys (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete restrict,
  scope            text not null check (scope ~ '^[a-z_]+(\.[a-z_]+)+$'),
  key              text not null check (length(key) between 8 and 200),
  request_hash     text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  actor_id         uuid,
  response         jsonb not null,
  expires_at       timestamptz not null default now() + interval '7 days',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, scope, key)
);
create index idempotency_keys_expires_at_idx on public.idempotency_keys (expires_at);
create trigger idempotency_keys_set_updated_at before update on public.idempotency_keys
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Rate limit por janela fixa. A chave chega já em hash (sem IP/e-mail em claro).
-- -----------------------------------------------------------------------------
create table public.rate_limit_buckets (
  key           text not null check (key ~ '^[a-z_:.]+:[0-9a-f]{64}$'),
  window_start  timestamptz not null,
  count         integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (key, window_start)
);
create index rate_limit_buckets_window_idx on public.rate_limit_buckets (window_start);

create or replace function app.rate_limit_hit(p_key text, p_window_seconds integer, p_max integer)
returns table (allowed boolean, current_count integer, reset_at timestamptz)
language plpgsql
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_count  integer;
begin
  if p_window_seconds <= 0 or p_max <= 0 then
    raise exception 'Parâmetros de rate limit inválidos';
  end if;
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limit_buckets as b (key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (key, window_start)
  do update set count = b.count + 1, updated_at = now()
  returning b.count into v_count;
  return query select v_count <= p_max, v_count, v_window + make_interval(secs => p_window_seconds);
end
$$;
revoke all on function app.rate_limit_hit(text, integer, integer) from public;
