import { computeBackoffMs, type BackoffOptions } from '@/server/core/backoff';
import { BusinessRuleError, ProviderError, ValidationError } from '@/server/core/errors';
import { defineStateMachine } from '@/server/core/state-machine';

export const JOB_STATUSES = ['PENDING', 'RUNNING', 'SUCCEEDED', 'DEAD_LETTER', 'CANCELLED'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const jobStateMachine = defineStateMachine<JobStatus>('job', {
  PENDING: ['RUNNING', 'CANCELLED'],
  // RUNNING -> PENDING = nova tentativa agendada (retry).
  RUNNING: ['SUCCEEDED', 'PENDING', 'DEAD_LETTER'],
  SUCCEEDED: [],
  DEAD_LETTER: ['PENDING'], // reprocessamento manual auditado
  CANCELLED: [],
});

/** Erros que não adianta repetir: dados inválidos ou regra de negócio. */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof ValidationError || err instanceof BusinessRuleError) return false;
  if (err instanceof ProviderError) return err.retryable;
  return true;
}

export type FailureDecision =
  | { status: 'PENDING'; nextRunAt: Date; backoffMs: number }
  | { status: 'DEAD_LETTER' };

export function decideFailure(
  attempts: number,
  maxAttempts: number,
  err: unknown,
  now: Date = new Date(),
  backoff: BackoffOptions = {},
): FailureDecision {
  if (!isRetryableError(err) || attempts >= maxAttempts) return { status: 'DEAD_LETTER' };
  const backoffMs = computeBackoffMs(attempts, backoff);
  return { status: 'PENDING', nextRunAt: new Date(now.getTime() + backoffMs), backoffMs };
}

/** Mensagem de erro truncada e sem stack para persistir em last_error. */
export function describeError(err: unknown): string {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return msg.slice(0, 2000);
}
