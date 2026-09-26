import 'server-only';
import { randomUUID } from 'node:crypto';
import { logger } from '@/server/core/logger';
import { getRequestContext } from '@/server/core/request-context';
import type { Tx } from '@/server/db/client';
import { withSystemTransaction } from '@/server/db/transaction';
import { decideFailure, describeError } from '@/server/modules/jobs/jobs.domain';
import {
  claimOutboxEvents,
  insertOutboxEvent,
  markOutboxDeadLetter,
  markOutboxPublished,
  markOutboxRetry,
  type OutboxRow,
} from './outbox.repository';
import type { OutboxEvent, OutboxPublisher } from './outbox.types';

export interface RecordEventInput {
  organizationId: string;
  /** PascalCase: ChargeCreated, PaymentReceived, DeliveryCompleted... */
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload?: Record<string, unknown>;
  /** Obrigatória: o mesmo fato de negócio nunca gera dois eventos. */
  idempotencyKey: string;
}

/** Grava o evento NA MESMA transação da operação de negócio. */
export async function recordOutboxEvent(tx: Tx, input: RecordEventInput): Promise<boolean> {
  return insertOutboxEvent(tx, {
    id: randomUUID(),
    organizationId: input.organizationId,
    eventType: input.eventType,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    payload: input.payload ?? {},
    idempotencyKey: input.idempotencyKey,
    correlationId: getRequestContext()?.correlationId ?? null,
  });
}

function toEvent(row: OutboxRow): OutboxEvent {
  return {
    id: row.id,
    organizationId: row.organization_id,
    eventType: row.event_type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    payload: row.payload,
    occurredAt: row.occurred_at,
    correlationId: row.correlation_id,
    attempts: row.attempts,
  };
}

export interface PublishSummary {
  claimed: number;
  published: number;
  retried: number;
  deadLettered: number;
  skipped: boolean;
}

/**
 * Publica eventos pendentes. Sem publisher configurado (credencial ausente),
 * nada é reivindicado: os eventos permanecem PENDING até a integração existir.
 */
export async function publishPendingOutboxEvents(
  publisher: OutboxPublisher | null,
  options: { batchSize?: number; lockTimeoutSeconds?: number } = {},
): Promise<PublishSummary> {
  const summary: PublishSummary = { claimed: 0, published: 0, retried: 0, deadLettered: 0, skipped: false };
  if (!publisher) {
    summary.skipped = true;
    return summary;
  }
  const rows = await withSystemTransaction((tx) =>
    claimOutboxEvents(tx, options.batchSize ?? 25, options.lockTimeoutSeconds ?? 300),
  );
  summary.claimed = rows.length;

  for (const row of rows) {
    try {
      await publisher.publish(toEvent(row));
      await withSystemTransaction((tx) => markOutboxPublished(tx, row.id));
      summary.published += 1;
    } catch (err) {
      const decision = decideFailure(row.attempts, row.max_attempts, err, new Date(), { baseMs: 15_000 });
      const error = describeError(err);
      if (decision.status === 'PENDING') {
        await withSystemTransaction((tx) => markOutboxRetry(tx, row.id, decision.nextRunAt, error));
        summary.retried += 1;
        logger.warn('outbox.publish_failed', { event_id: row.id, publisher: publisher.name, attempts: row.attempts, error });
      } else {
        await withSystemTransaction((tx) => markOutboxDeadLetter(tx, row.id, error));
        summary.deadLettered += 1;
        logger.error('outbox.dead_letter', { event_id: row.id, publisher: publisher.name, attempts: row.attempts, error });
      }
    }
  }
  return summary;
}
