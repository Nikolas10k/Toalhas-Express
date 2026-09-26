import { describe, expect, it } from 'vitest';
import { BusinessRuleError, ProviderError, ValidationError } from '@/server/core/errors';
import { decideFailure, describeError, isRetryableError } from '@/server/modules/jobs/jobs.domain';

describe('decisão de falha de job', () => {
  const now = new Date('2026-01-01T00:00:00Z');

  it('agenda retry com backoff enquanto houver tentativas', () => {
    const d = decideFailure(1, 5, new Error('timeout'), now, { baseMs: 1000, random: () => 0 });
    expect(d).toEqual({ status: 'PENDING', nextRunAt: new Date(now.getTime() + 500), backoffMs: 500 });
  });

  it('vai para DEAD_LETTER ao esgotar tentativas', () => {
    expect(decideFailure(5, 5, new Error('x'), now)).toEqual({ status: 'DEAD_LETTER' });
  });

  it('erros não repetíveis vão direto para DEAD_LETTER', () => {
    expect(isRetryableError(new ValidationError())).toBe(false);
    expect(isRetryableError(new BusinessRuleError('x'))).toBe(false);
    expect(isRetryableError(new ProviderError('asaas', 'x', { retryable: false }))).toBe(false);
    expect(isRetryableError(new ProviderError('asaas', 'x'))).toBe(true);
    expect(decideFailure(1, 5, new ValidationError(), now)).toEqual({ status: 'DEAD_LETTER' });
  });

  it('describeError trunca e não inclui stack', () => {
    const msg = describeError(new Error('a'.repeat(5000)));
    expect(msg.length).toBe(2000);
    expect(msg).not.toContain('at ');
  });
});
