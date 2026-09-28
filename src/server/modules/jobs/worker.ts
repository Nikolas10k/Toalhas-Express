import 'server-only';
import { getServerEnv } from '@/server/core/env';
import { logger } from '@/server/core/logger';
import { withSystemTransaction } from '@/server/db/transaction';
import { N8nOutboxPublisher } from '@/server/modules/outbox/n8n-publisher';
import { publishPendingOutboxEvents } from '@/server/modules/outbox/outbox.service';
import type { OutboxPublisher } from '@/server/modules/outbox/outbox.types';
import { enqueueJob, runPendingJobs, type JobHandler } from './jobs.service';
import { MAINTENANCE_CLEANUP_JOB, maintenanceCleanupHandler } from './maintenance';
import {
  GEOCODE_CUSTOMER_JOB,
  GEOCODE_PENDING_JOB,
  geocodeCustomerHandler,
  geocodePendingHandler,
} from '@/server/modules/customers/geocoding.service';
import { INVENTORY_CHECK_JOB, inventoryCheckHandler } from '@/server/modules/inventory/consistency.service';
import { RENEWAL_JOB, renewalHandler } from '@/server/modules/contracts/contracts.service';
import { GENERATE_RECURRING_JOB, generateRecurringHandler } from '@/server/modules/orders/recurrence.service';

/** Registro central de handlers. Cada fase adiciona os seus aqui. */
export function buildJobHandlers(): ReadonlyMap<string, JobHandler> {
  return new Map<string, JobHandler>([
    [MAINTENANCE_CLEANUP_JOB, maintenanceCleanupHandler],
    [GEOCODE_CUSTOMER_JOB, geocodeCustomerHandler],
    [GEOCODE_PENDING_JOB, geocodePendingHandler],
    [INVENTORY_CHECK_JOB, inventoryCheckHandler],
    [GENERATE_RECURRING_JOB, generateRecurringHandler],
    [RENEWAL_JOB, renewalHandler],
  ]);
}

export function buildOutboxPublisher(): OutboxPublisher | null {
  const env = getServerEnv();
  if (!env.N8N_OUTBOX_WEBHOOK_URL || !env.N8N_OUTBOX_HMAC_SECRET) return null;
  return new N8nOutboxPublisher(env.N8N_OUTBOX_WEBHOOK_URL, env.N8N_OUTBOX_HMAC_SECRET);
}

/** Um ciclo do worker: agenda rotinas diárias, publica outbox e roda jobs. */
export async function runWorkerCycle() {
  const today = new Date().toISOString().slice(0, 10);
  await withSystemTransaction((tx) =>
    enqueueJob(tx, {
      type: MAINTENANCE_CLEANUP_JOB,
      organizationId: null,
      idempotencyKey: `${MAINTENANCE_CLEANUP_JOB}:${today}`,
      maxAttempts: 3,
    }),
  );

  await withSystemTransaction((tx) =>
    enqueueJob(tx, {
      type: INVENTORY_CHECK_JOB,
      organizationId: null,
      idempotencyKey: `${INVENTORY_CHECK_JOB}:${today}`,
      maxAttempts: 3,
    }),
  );

  await withSystemTransaction(async (tx) => {
    await enqueueJob(tx, { type: GENERATE_RECURRING_JOB, organizationId: null, idempotencyKey: `${GENERATE_RECURRING_JOB}:${today}`, maxAttempts: 5 });
    await enqueueJob(tx, { type: RENEWAL_JOB, organizationId: null, idempotencyKey: `${RENEWAL_JOB}:${today}`, maxAttempts: 5 });
  });

  const publisher = buildOutboxPublisher();
  if (!publisher) logger.warn('outbox.publisher_not_configured');
  const outbox = await publishPendingOutboxEvents(publisher);
  const jobs = await runPendingJobs(buildJobHandlers(), { timeBudgetMs: 20_000 });
  logger.info('worker.cycle_completed', { outbox, jobs });
  return { outbox, jobs };
}
