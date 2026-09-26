import 'server-only';
import { getServerEnv } from '@/server/core/env';
import { logger } from '@/server/core/logger';
import { withSystemTransaction } from '@/server/db/transaction';
import { N8nOutboxPublisher } from '@/server/modules/outbox/n8n-publisher';
import { publishPendingOutboxEvents } from '@/server/modules/outbox/outbox.service';
import type { OutboxPublisher } from '@/server/modules/outbox/outbox.types';
import { enqueueJob, runPendingJobs, type JobHandler } from './jobs.service';
import { MAINTENANCE_CLEANUP_JOB, maintenanceCleanupHandler } from './maintenance';

/** Registro central de handlers. Cada fase adiciona os seus aqui. */
export function buildJobHandlers(): ReadonlyMap<string, JobHandler> {
  return new Map<string, JobHandler>([[MAINTENANCE_CLEANUP_JOB, maintenanceCleanupHandler]]);
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

  const publisher = buildOutboxPublisher();
  if (!publisher) logger.warn('outbox.publisher_not_configured');
  const outbox = await publishPendingOutboxEvents(publisher);
  const jobs = await runPendingJobs(buildJobHandlers(), { timeBudgetMs: 20_000 });
  logger.info('worker.cycle_completed', { outbox, jobs });
  return { outbox, jobs };
}
