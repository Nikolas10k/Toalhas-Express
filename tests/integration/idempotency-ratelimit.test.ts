import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { UserActor } from '@/server/auth/actor';
import { ConflictError, RateLimitError } from '@/server/core/errors';
import { resolveUserActor } from '@/server/modules/access/access.service';
import { recordAudit } from '@/server/modules/audit/audit.service';
import { executeIdempotent } from '@/server/modules/idempotency/idempotency.service';
import { hitRateLimit } from '@/server/modules/rate-limit/rate-limit.service';
import { createOrg, createUserInOrg, sql } from './fixtures';

let org: string;
let actor: UserActor;

beforeAll(async () => {
  org = await createOrg('idem');
  const { userId } = await createUserInOrg(org, ['MANAGER']);
  actor = (await resolveUserActor({ userId, aal: 'aal1' }))!;
});

async function countEffects(entityId: string) {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from public.audit_logs where organization_id = ${org} and entity_id = ${entityId}
  `;
  return row!.n;
}

describe('idempotência de comandos', () => {
  it('duplo clique executa o efeito uma única vez', async () => {
    const key = `key-${randomUUID()}`;
    const entityId = randomUUID();
    const run = () =>
      executeIdempotent(actor, { scope: 'test.command', key, request: { amount: 500 } }, async (tx) => {
        await recordAudit(tx, actor, org, { action: 'test.effect', entityType: 'test', entityId });
        return { chargeId: entityId };
      });
    const first = await run();
    const second = await run();
    expect(first).toEqual({ result: { chargeId: entityId }, replayed: false });
    expect(second).toEqual({ result: { chargeId: entityId }, replayed: true });
    expect(await countEffects(entityId)).toBe(1);
  });

  it('requisições simultâneas com a mesma chave não duplicam', async () => {
    const key = `key-${randomUUID()}`;
    const entityId = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        executeIdempotent(actor, { scope: 'test.command', key, request: { a: 1 } }, async (tx) => {
          await recordAudit(tx, actor, org, { action: 'test.effect', entityType: 'test', entityId });
          await tx`select pg_sleep(0.05)`;
          return { ok: true };
        }),
      ),
    );
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await countEffects(entityId)).toBe(1);
  });

  it('reusar a chave com outros dados é conflito', async () => {
    const key = `key-${randomUUID()}`;
    await executeIdempotent(actor, { scope: 'test.command', key, request: { amount: 1 } }, async () => ({ ok: 1 }));
    await expect(
      executeIdempotent(actor, { scope: 'test.command', key, request: { amount: 2 } }, async () => ({ ok: 2 })),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('falha no comando não consome a chave', async () => {
    const key = `key-${randomUUID()}`;
    await expect(
      executeIdempotent(actor, { scope: 'test.command', key, request: {} }, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const retry = await executeIdempotent(actor, { scope: 'test.command', key, request: {} }, async () => ({ ok: true }));
    expect(retry.replayed).toBe(false);
  });
});

describe('rate limit', () => {
  it('bloqueia após o limite e informa Retry-After', async () => {
    const rule = { name: 'test.rule', max: 3, windowSeconds: 60 };
    const id = randomUUID();
    for (let i = 0; i < 3; i++) await hitRateLimit(rule, id);
    const err = await hitRateLimit(rule, id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfterSeconds).toBeGreaterThan(0);
    // Outro identificador não é afetado.
    await expect(hitRateLimit(rule, randomUUID())).resolves.toBeUndefined();
  });

  it('não grava o identificador em claro', async () => {
    const email = `pessoa-${randomUUID()}@example.com`;
    await hitRateLimit({ name: 'test.pii', max: 5, windowSeconds: 60 }, email);
    const rows = await sql`select key from public.rate_limit_buckets where key like ${'%' + email + '%'}`;
    expect(rows).toHaveLength(0);
  });
});
