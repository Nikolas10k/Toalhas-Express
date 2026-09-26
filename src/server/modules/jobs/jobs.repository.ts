import 'server-only';
import type { Tx } from '@/server/db/client';

export interface JobRow {
  id: string;
  organization_id: string | null;
  type: string;
  payload: Record<string, unknown>;
  status: string;
  priority: number;
  attempts: number;
  max_attempts: number;
  next_run_at: Date;
  locked_by: string | null;
  last_error: string | null;
  idempotency_key: string | null;
  correlation_id: string | null;
}

export interface JobInsert {
  id: string;
  organizationId: string | null;
  type: string;
  payload: Record<string, unknown>;
  priority: number;
  maxAttempts: number;
  runAt: Date;
  idempotencyKey: string | null;
  correlationId: string | null;
}

/** Idempotente: mesma idempotency_key não gera segundo job. */
export async function insertJob(tx: Tx, job: JobInsert): Promise<boolean> {
  const result = await tx`
    insert into public.jobs (id, organization_id, type, payload, priority, max_attempts, next_run_at, idempotency_key, correlation_id)
    values (${job.id}, ${job.organizationId}, ${job.type}, ${tx.json(job.payload as never)}, ${job.priority},
            ${job.maxAttempts}, ${job.runAt}, ${job.idempotencyKey}, ${job.correlationId})
    on conflict (idempotency_key) do nothing
  `;
  return result.count === 1;
}

export async function claimJobs(tx: Tx, workerId: string, limit: number, lockTimeoutSeconds: number): Promise<JobRow[]> {
  return tx<JobRow[]>`
    select * from app.claim_jobs(${workerId}, ${limit}, make_interval(secs => ${lockTimeoutSeconds}))
  `;
}

export async function markJobSucceeded(tx: Tx, jobId: string, workerId: string): Promise<boolean> {
  const r = await tx`
    update public.jobs
       set status = 'SUCCEEDED', completed_at = now(), locked_at = null, locked_by = null, last_error = null
     where id = ${jobId} and status = 'RUNNING' and locked_by = ${workerId}
  `;
  return r.count === 1;
}

export async function markJobRetry(tx: Tx, jobId: string, workerId: string, nextRunAt: Date, error: string): Promise<boolean> {
  const r = await tx`
    update public.jobs
       set status = 'PENDING', next_run_at = ${nextRunAt}, locked_at = null, locked_by = null, last_error = ${error}
     where id = ${jobId} and status = 'RUNNING' and locked_by = ${workerId}
  `;
  return r.count === 1;
}

export async function markJobDeadLetter(tx: Tx, jobId: string, workerId: string, error: string): Promise<boolean> {
  const r = await tx`
    update public.jobs
       set status = 'DEAD_LETTER', completed_at = now(), locked_at = null, locked_by = null, last_error = ${error}
     where id = ${jobId} and status = 'RUNNING' and locked_by = ${workerId}
  `;
  return r.count === 1;
}

export async function countJobsByStatus(tx: Tx): Promise<Record<string, number>> {
  const rows = await tx<{ status: string; total: number }[]>`
    select status, count(*)::int as total from public.jobs group by status
  `;
  return Object.fromEntries(rows.map((r) => [r.status, r.total]));
}
