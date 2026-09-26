-- Fixa search_path das funções restantes (linter do Supabase: function_search_path_mutable).
alter function app.current_user_id() set search_path = '';
alter function app.current_org_id() set search_path = '';
alter function app.current_actor_type() set search_path = '';
alter function app.current_integration_token_id() set search_path = '';
alter function app.current_actor_id() set search_path = '';
alter function app.set_updated_at() set search_path = '';
alter function app.prevent_mutation() set search_path = '';
alter function app.outbox_guard_immutable() set search_path = '';

-- rate_limit_buckets tem RLS sem policy DE PROPÓSITO: só o backend (sistema) acessa.
comment on table public.rate_limit_buckets is 'Rate limit (hash). Sem policies por design: acesso apenas do backend em contexto de sistema.';
