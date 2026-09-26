import 'server-only';
import { randomUUID } from 'node:crypto';
import { logger } from '@/server/core/logger';
import { createRequestContext, getRequestContext, runWithRequestContext } from '@/server/core/request-context';
import type { Tx } from '@/server/db/client';
import { withSystemTransaction } from '@/server/db/transaction';
import { decideFailure, describeError } from './jobs.domain';
import {
  claimJobs,
  insertJob,
  markJobDeadLetter,
  markJobRetry,
  markJobSucceeded,
  type JobRow,
} from './jobs.repository';

export interface EnqueueJobInput {
  type: string;
  organizationId: string | null;
  payload?: Record<string, unknown>;
  /** Chave única: repetir o enqueue com a mesma chave não duplica o job. */
  idempotencyKey?: string;
  runAt?: Date;
  priority?: number;
  maxAttempts?: number;
}

/**
 * Enfileira dentro da transação do chamador (mesma atomicidade da operação).
 * Retorna false quando a idempotency_key já existia.
 */
export async function enqueueJob(tx: Tx, input: EnqueueJobInput): Promise<boolean> {
  return insertJob(tx, {
    id: randomUUID(),
    organizationId: input.organizationId,
    type: input.type,
    payload: input.payload ?? {},
    priority: input.priority ?? 0,
    maxAttempts: input.maxAttempts ?? 8,
    runAt: input.runAt ?? new Date(),
    idempotencyKey: input.idempotencyKey ?? null,
    correlationId: getRequestContext()?.correlationId ?? null,
  });
}

export interface JobContext {
  job: Readonly<JobRow>;
}

export type JobHandler = (ctx: JobContext) => Promise<void>;
export type JobHandlerRegistry = ReadonlyMap<string, JobHandler>;

export interface RunJobsOptions {
  workerId?: string;
  batchSize?: number;
  /** Para de buscar novos lotes após este tempo (limite de função serverless). */
  timeBudgetMs?: number;
  lockTimeoutSeconds?: number;
}

export interface RunJobsSummary {
  claimed: number;
  succeeded: number;
  retried: number;
  deadLettered: number;
}

/**
 * Executa jobs pendentes. Cada job roda FORA da transação de claim, portanto
 * um handler lento não segura locks. O handler deve ser idempotente: em caso
 * de crash após efeito externo, o job é reexecutado após o lock expirar.
 */
export async function runPendingJobs(handlers: JobHandlerRegistry, options: RunJobsOptions = {}): Promise<RunJobsSummary> {
  const workerId = options.workerId ?? `worker-${randomUUID()}`;
  const batchSize = options.batchSize ?? 10;
  const deadline = Date.now() + (options.timeBudgetMs ?? 20_000);
  const lockTimeout = options.lockTimeoutSeconds ?? 300;
  const summary: RunJobsSummary = { claimed: 0, succeeded: 0, retried: 0, deadLettered: 0 };

  while (Date.now() < deadline) {
    const jobs = await withSystemTransaction((tx) => claimJobs(tx, workerId, batchSize, lockTimeout));
    if (jobs.length === 0) break;
    summary.claimed += jobs.length;

    for (const job of jobs) {
      const outcome = await executeJob(job, handlers, workerId);
      summary[outcome] += 1;
    }
    if (jobs.length < batchSize) break;
  }
  return summary;
}

async function executeJob(
  job: JobRow,
  handlers: JobHandlerRegistry,
  workerId: string,
): Promise<'succeeded' | 'retried' | 'deadLettered'> {
  const ctx = createRequestContext({ correlationId: job.correlation_id ?? undefined });
  return runWithRequestContext(ctx, async () => {
    // Lock expirado reclamado além do limite: não roda de novo.
    if (job.attempts > job.max_attempts) {
      await withSystemTransaction((tx) => markJobDeadLetter(tx, job.id, workerId, 'Limite de tentativas excedido.'));
      logger.error('job.dead_letter', { job_id: job.id, job_type: job.type, attempts: job.attempts });
      return 'deadLettered';
    }

    const handler = handlers.get(job.type);
    try {
      if (!handler) throw new Error(`Nenhum handler registrado para o tipo ${job.type}`);
      await handler({ job });
      await withSystemTransaction((tx) => markJobSucceeded(tx, job.id, workerId));
      logger.info('job.succeeded', { job_id: job.id, job_type: job.type, attempts: job.attempts });
      return 'succeeded';
    } catch (err) {
      const decision = decideFailure(job.attempts, job.max_attempts, handler ? err : new Error('no handler'));
      const error = describeError(err);
      if (decision.status === 'PENDING') {
        await withSystemTransaction((tx) => markJobRetry(tx, job.id, workerId, decision.nextRunAt, error));
        logger.warn('job.retry_scheduled', {
          job_id: job.id,
          job_type: job.type,
          attempts: job.attempts,
          next_run_at: decision.nextRunAt.toISOString(),
          error,
        });
        return 'retried';
      }
      await withSystemTransaction((tx) => markJobDeadLetter(tx, job.id, workerId, error));
      logger.error('job.dead_letter', { job_id: job.id, job_type: job.type, attempts: job.attempts, error });
      return 'deadLettered';
    }
  });
}
