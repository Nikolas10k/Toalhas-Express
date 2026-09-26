import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export interface RequestContext {
  requestId: string;
  correlationId: string;
  ip?: string;
  userAgent?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

const SAFE_ID = /^[A-Za-z0-9._-]{8,100}$/;

/** Aceita correlation id vindo de fora apenas se for bem formado. */
export function sanitizeCorrelationId(value: string | null | undefined): string | undefined {
  return value && SAFE_ID.test(value) ? value : undefined;
}

export function createRequestContext(input: Partial<RequestContext> = {}): RequestContext {
  const requestId = input.requestId ?? randomUUID();
  return {
    requestId,
    correlationId: input.correlationId ?? requestId,
    ip: input.ip,
    userAgent: input.userAgent?.slice(0, 512),
  };
}

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
