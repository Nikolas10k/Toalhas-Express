import 'server-only';
import type { Tx } from '@/server/db/client';

export interface OutboxRow {
  id: string;
  organization_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
  max_attempts: number;
  occurred_at: Date;
  correlation_id: string | null;
}

export interface OutboxInsert {
  id: string;
  organizationId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  correlationId: string | null;
}

export async function insertOutboxEvent(tx: Tx, e: OutboxInsert): Promise<boolean> {
  const r = await tx`
    insert into public.outbox_events (id, organization_id, event_type, aggregate_type, aggregate_id, payload, idempotency_key, correlation_id)
    values (${e.id}, ${e.organizationId}, ${e.eventType}, ${e.aggregateType}, ${e.aggregateId},
            ${tx.json(e.payload as never)}, ${e.idempotencyKey}, ${e.correlationId})
    on conflict (idempotency_key) do nothing
  `;
  return r.count === 1;
}

export async function claimOutboxEvents(tx: Tx, limit: number, lockTimeoutSeconds: number): Promise<OutboxRow[]> {
  return tx<OutboxRow[]>`
    select * from app.claim_outbox_events(${limit}, make_interval(secs => ${lockTimeoutSeconds}))
  `;
}

export async function markOutboxPublished(tx: Tx, id: string): Promise<void> {
  await tx`
    update public.outbox_events
       set status = 'PUBLISHED', published_at = now(), locked_at = null, last_error = null
     where id = ${id} and status = 'PUBLISHING'
  `;
}

export async function markOutboxRetry(tx: Tx, id: string, nextAttemptAt: Date, error: string): Promise<void> {
  await tx`
    update public.outbox_events
       set status = 'PENDING', next_attempt_at = ${nextAttemptAt}, locked_at = null, last_error = ${error}
     where id = ${id} and status = 'PUBLISHING'
  `;
}

export async function markOutboxDeadLetter(tx: Tx, id: string, error: string): Promise<void> {
  await tx`
    update public.outbox_events
       set status = 'DEAD_LETTER', locked_at = null, last_error = ${error}
     where id = ${id} and status = 'PUBLISHING'
  `;
}
