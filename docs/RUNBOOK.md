# Runbook

## Saúde

- `GET /api/health` → `status: ok|degraded`, `database: ok|unavailable`.
- Logs estruturados (JSON) na Vercel: filtrar por `request_id` (header `x-request-id` de toda resposta) ou `correlation_id`.

## Worker, jobs e outbox

Rodar um ciclo manualmente:

```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/internal/jobs/run
```

Consultas úteis (SQL editor do Supabase, role `postgres`):

```sql
-- Situação da fila
select status, count(*) from public.jobs group by status;
select status, count(*) from public.outbox_events group by status;

-- Dead letters recentes
select id, type, attempts, last_error, updated_at from public.jobs
where status = 'DEAD_LETTER' order by updated_at desc limit 50;

select id, event_type, attempts, last_error, updated_at from public.outbox_events
where status = 'DEAD_LETTER' order by updated_at desc limit 50;
```

Reprocessar um job em dead letter (após corrigir a causa) — registre na auditoria:

```sql
begin;
update public.jobs set status = 'PENDING', attempts = 0, next_run_at = now(), last_error = null
 where id = '<job_id>' and status = 'DEAD_LETTER';
insert into public.audit_logs (organization_id, actor_type, action, entity_type, entity_id, metadata)
values (null, 'SYSTEM', 'job.requeued', 'job', '<job_id>', '{"operator":"<seu nome>","reason":"<motivo>"}');
commit;
```

Mesmo procedimento para `outbox_events` (`status = 'PENDING', attempts = 0, next_attempt_at = now()`).

**n8n fora do ar**: nada a fazer no app — eventos acumulam como `PENDING`/retry e são publicados quando o n8n voltar. Se passarem de `max_attempts`, reprocesse os dead letters.

## Estoque

- **Alerta "Saldos de estoque não conferem com o ledger"**: o ledger (`towel_movements`) é a verdade. Divergências: `select * from app.inventory_consistency('<org_id>');`. Cache divergente só ocorre por alteração manual no banco — investigue auditoria e logs do Postgres. Reconstrução do cache a partir do ledger (registrada):

  ```sql
  begin;
  lock table public.stock_balances in exclusive mode;
  delete from public.stock_balances where organization_id = '<org_id>';
  insert into public.stock_balances (organization_id, product_id, state, customer_key, customer_id, quantity)
  select organization_id, product_id, state, coalesce(customer_id, '00000000-0000-0000-0000-000000000000'), customer_id, sum(q)
    from (
      select organization_id, product_id, from_state as state,
             case when from_state = 'WITH_CUSTOMER' then customer_id end as customer_id, -quantity as q
        from public.towel_movements where organization_id = '<org_id>' and from_state <> 'EXTERNAL'
      union all
      select organization_id, product_id, to_state, case when to_state = 'WITH_CUSTOMER' then customer_id end, quantity
        from public.towel_movements where organization_id = '<org_id>' and to_state <> 'EXTERNAL'
    ) d group by 1, 2, 3, 4, 5;
  insert into public.audit_logs (organization_id, actor_type, action, entity_type, metadata)
  values ('<org_id>', 'SYSTEM', 'inventory.cache_rebuilt', 'organization', '{"operator":"<nome>","reason":"<motivo>"}');
  commit;
  ```
- **Lançamento errado**: nunca edite o ledger — use "Estornar" em Estoque → Movimentações.

## Acesso e segurança

- **Revogar token de integração**: `update public.integration_tokens set revoked_at = now() where id = '<id>';` (efeito imediato — RLS e resolução do ator checam `revoked_at`).
- **Suspender usuário**: `update public.organization_members set status = 'suspended' where id = '<member_id>';` (perde todas as permissões na próxima requisição). Para encerrar sessões: Supabase → Authentication → Users → *Sign out user*.
- **Admin perdeu o autenticador**: outro ADMIN (ou o suporte via painel Supabase → Authentication → Users → Factors) remove o fator; o usuário reconfigura no próximo login. Registre o motivo na auditoria.
- **Vazamento de segredo**: rotacione imediatamente na origem (Supabase/Asaas/n8n), atualize na Vercel, faça redeploy e revise `audit_logs` pelo período.
- **Rate limit bloqueando usuário legítimo**: `delete from public.rate_limit_buckets where key like 'auth.login:%';` (chaves são hashes; limpar por regra).

## Backup e restore

- Supabase faz backups diários (retenção conforme plano); habilite **PITR** em produção.
- Backup lógico adicional (semanal, fora do Supabase):
  `pg_dump "$DATABASE_URL_DIRECT" --format=custom --no-owner --file=toalhas-$(date +%F).dump`
  (use a conexão direta, porta 5432, não o pooler).
- Restore em ambiente isolado primeiro:
  `pg_restore --no-owner --clean --if-exists --dbname="$TARGET_URL" toalhas-AAAA-MM-DD.dump`
- Teste de restore trimestral documentado (data, tamanho, tempo, validação por contagem de linhas e diagnóstico de consistência — Fase 12).

## Testes locais

```bash
sudo service postgresql start          # ou docker run -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16
npm run test:integration               # recria o banco *_test e roda os testes
npm run build && npm run test:e2e      # E2E contra o build de produção
```

Se o Chromium do Playwright já estiver instalado em outro caminho: `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/caminho/chrome npm run test:e2e`.
