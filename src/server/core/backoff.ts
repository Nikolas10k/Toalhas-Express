export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  /** Fonte de aleatoriedade injetável para testes. Retorna [0, 1). */
  random?: () => number;
}

/**
 * Backoff exponencial com "equal jitter": metade fixa + metade aleatória.
 * attempt começa em 1 (primeira falha).
 */
export function computeBackoffMs(attempt: number, options: BackoffOptions = {}): number {
  const baseMs = options.baseMs ?? 30_000;
  const maxMs = options.maxMs ?? 60 * 60_000;
  const random = options.random ?? Math.random;
  const n = Math.max(1, Math.floor(attempt));
  const exp = Math.min(maxMs, baseMs * 2 ** Math.min(n - 1, 30));
  const half = exp / 2;
  return Math.round(half + random() * half);
}
