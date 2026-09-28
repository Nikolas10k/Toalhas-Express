-- Funções de trigger com search_path fixo (apontado pelo advisor do Supabase).
-- Idempotente: a migration anterior já cria as funções assim em ambientes novos.
alter function app.attachments_guard() set search_path = '';
alter function app.billable_events_guard() set search_path = '';
