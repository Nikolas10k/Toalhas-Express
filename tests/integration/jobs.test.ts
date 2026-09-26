import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/server/core/errors';
import { withSystemTransaction } from '@/server/db/transaction';
import { claimJobs } from '@/server/modules/jobs/jobs.repository';
import { enqueueJob, runPendingJobs, type JobHandler } from '@/server/modules/jobs/jobs.service';
import { sql } from './fixtures';

async function jobByKey(key: string) {
  const [row] = await sql<{ status: string; attempts: number; last_error: string | null; next_run_at: Date }[]>`
    select status, attempts, last_error, next_run_at from public.jobs where idempotency_key = ${key}
  `;
  return row!;
}

async function drain() {
  // Isola cada teste: cancela pendências de testes anteriores.
  await sql`update public.jobs set status = 'CANCELLED' where status in ('PENDING', 'RUNNING')`;
}

describe('fila de jobs', () => {
  it('enqueue é idempotente por chave', async () => {
    const key = `test.idem:${randomUUID()}`;
    const first = await withSystemTransaction((tx) => enqueueJob(tx, { type: 'test.noop', organizationId: null, idempotencyKey: key }));
    const second = await withSystemTransaction((tx) => enqueueJob(tx, { type: 'test.noop', organizationId: null, idempotencyKey: key }));
    expect([first, second]).toEqual([true, false]);
    const [{ total }] = (await sql`select count(*)::int as total from public.jobs where idempotency_key = ${key}`) as unknown as [
      { total: number },
    ];
    expect(total).toBe(1);
  });

  it('executa com sucesso, agenda retry com backoff e manda para DEAD_LETTER', async () => {
    await drain();
    const ok = `test.ok:${randomUUID()}`;
    const flaky = `test.flaky:${randomUUID()}`;
    const invalid = `test.invalid:${randomUUID()}`;
    const exhausted = `test.exhausted:${randomUUID()}`;
    await withSystemTransaction(async (tx) => {
      await enqueueJob(tx, { type: 'test.ok', organizationId: null, idempotencyKey: ok });
      await enqueueJob(tx, { type: 'test.flaky', organizationId: null, idempotencyKey: flaky, maxAttempts: 3 });
      await enqueueJob(tx, { type: 'test.invalid', organizationId: null, idempotencyKey: invalid });
      await enqueueJob(tx, { type: 'test.flaky', organizationId: null, idempotencyKey: exhausted, maxAttempts: 1 });
    });
    const handlers = new Map<string, JobHandler>([
      ['test.ok', async () => {}],
      ['test.flaky', async () => { throw new Error('timeout no provider'); }],
      ['test.invalid', async () => { throw new ValidationError('payload inválido'); }],
    ]);
    const before = Date.now();
    const summary = await runPendingJobs(handlers, { batchSize: 10 });
    expect(summary).toEqual({ claimed: 4, succeeded: 1, retried: 1, deadLettered: 2 });

    expect((await jobByKey(ok)).status).toBe('SUCCEEDED');
    const f = await jobByKey(flaky);
    expect(f.status).toBe('PENDING');
    expect(f.attempts).toBe(1);
    expect(f.last_error).toContain('timeout no provider');
    expect(f.next_run_at.getTime()).toBeGreaterThan(before + 10_000);
    expect((await jobByKey(invalid)).status).toBe('DEAD_LETTER');
    expect((await jobByKey(exhausted)).status).toBe('DEAD_LETTER');
  });

  it('tipo sem handler vai para retry e depois dead letter, sem derrubar o worker', async () => {
    await drain();
    const key = `test.unknown:${randomUUID()}`;
    await withSystemTransaction((tx) => enqueueJob(tx, { type: 'test.unknown', organizationId: null, idempotencyKey: key, maxAttempts: 1 }));
    const summary = await runPendingJobs(new Map());
    expect(summary.deadLettered).toBe(1);
    expect((await jobByKey(key)).last_error).toContain('Nenhum handler');
  });

  it('workers concorrentes nunca reivindicam o mesmo job (SKIP LOCKED)', async () => {
    await drain();
    await withSystemTransaction(async (tx) => {
      for (let i = 0; i < 20; i++) await enqueueJob(tx, { type: 'test.concurrent', organizationId: null });
    });
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => withSystemTransaction((tx) => claimJobs(tx, `w${i}`, 10, 300))),
    );
    const ids = results.flat().map((j) => j.id);
    expect(ids.length).toBe(20);
    expect(new Set(ids).size).toBe(20);
  });

  it('job travado por worker morto é retomado após expirar o lock', async () => {
    await drain();
    const key = `test.stale:${randomUUID()}`;
    await withSystemTransaction((tx) => enqueueJob(tx, { type: 'test.ok', organizationId: null, idempotencyKey: key }));
    await withSystemTransaction((tx) => claimJobs(tx, 'dead-worker', 10, 300));
    await sql`update public.jobs set locked_at = now() - interval '10 minutes' where idempotency_key = ${key}`;
    const summary = await runPendingJobs(new Map([['test.ok', async () => {}]]));
    expect(summary.succeeded).toBe(1);
    const job = await jobByKey(key);
    expect(job).toMatchObject({ status: 'SUCCEEDED', attempts: 2 });
  });

  it('jobs não podem ser apagados', async () => {
    await expect(sql`delete from public.jobs`).rejects.toThrow(/append-only/);
  });
});
