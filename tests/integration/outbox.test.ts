import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { withActorTransaction, withSystemTransaction } from '@/server/db/transaction';
import { publishPendingOutboxEvents, recordOutboxEvent } from '@/server/modules/outbox/outbox.service';
import type { OutboxEvent, OutboxPublisher } from '@/server/modules/outbox/outbox.types';
import { createOrg, createUserInOrg, sql } from './fixtures';

let org: string;
let userId: string;

beforeAll(async () => {
  org = await createOrg('outbox');
  userId = (await createUserInOrg(org, ['MANAGER'])).userId;
});

async function statusOf(key: string) {
  const [row] = await sql<{ status: string; attempts: number; last_error: string | null }[]>`
    select status, attempts, last_error from public.outbox_events where idempotency_key = ${key}
  `;
  return row;
}

async function resetPending() {
  await sql`update public.outbox_events set status = 'DEAD_LETTER' where status in ('PENDING', 'PUBLISHING')`;
}

class FakePublisher implements OutboxPublisher {
  readonly name = 'fake';
  published: OutboxEvent[] = [];
  constructor(private readonly fail = false) {}
  async publish(event: OutboxEvent) {
    if (this.fail) throw new Error('n8n fora do ar');
    this.published.push(event);
  }
}

describe('outbox transacional', () => {
  it('evento é gravado junto com a operação e desfeito se ela falhar', async () => {
    const committed = `ok:${randomUUID()}`;
    const rolledBack = `rb:${randomUUID()}`;
    await withActorTransaction({ type: 'USER', userId, organizationId: org }, (tx) =>
      recordOutboxEvent(tx, { organizationId: org, eventType: 'OrderConfirmed', aggregateType: 'order', aggregateId: '1', idempotencyKey: committed }),
    );
    await expect(
      withActorTransaction({ type: 'USER', userId, organizationId: org }, async (tx) => {
        await recordOutboxEvent(tx, { organizationId: org, eventType: 'OrderConfirmed', aggregateType: 'order', aggregateId: '2', idempotencyKey: rolledBack });
        throw new Error('falha na operação');
      }),
    ).rejects.toThrow('falha na operação');
    expect((await statusOf(committed))?.status).toBe('PENDING');
    expect(await statusOf(rolledBack)).toBeUndefined();
  });

  it('mesmo fato de negócio não gera dois eventos', async () => {
    const key = `dup:${randomUUID()}`;
    const input = { organizationId: org, eventType: 'ChargeCreated', aggregateType: 'charge', aggregateId: 'c', idempotencyKey: key };
    const r1 = await withSystemTransaction((tx) => recordOutboxEvent(tx, input));
    const r2 = await withSystemTransaction((tx) => recordOutboxEvent(tx, input));
    expect([r1, r2]).toEqual([true, false]);
  });

  it('sem publisher configurado, eventos continuam pendentes', async () => {
    await resetPending();
    const key = `nopub:${randomUUID()}`;
    await withSystemTransaction((tx) =>
      recordOutboxEvent(tx, { organizationId: org, eventType: 'PaymentReceived', aggregateType: 'payment', aggregateId: 'p', idempotencyKey: key }),
    );
    const summary = await publishPendingOutboxEvents(null);
    expect(summary.skipped).toBe(true);
    expect(await statusOf(key)).toMatchObject({ status: 'PENDING', attempts: 0 });
  });

  it('publica com sucesso ou agenda retry quando o n8n cai', async () => {
    await resetPending();
    const key = `pub:${randomUUID()}`;
    await withSystemTransaction((tx) =>
      recordOutboxEvent(tx, { organizationId: org, eventType: 'DeliveryCompleted', aggregateType: 'delivery', aggregateId: 'd', idempotencyKey: key }),
    );
    const failing = await publishPendingOutboxEvents(new FakePublisher(true));
    expect(failing).toMatchObject({ claimed: 1, retried: 1 });
    expect(await statusOf(key)).toMatchObject({ status: 'PENDING', attempts: 1, last_error: expect.stringContaining('n8n fora do ar') });

    await sql`update public.outbox_events set next_attempt_at = now() where idempotency_key = ${key}`;
    const pub = new FakePublisher();
    const ok = await publishPendingOutboxEvents(pub);
    expect(ok).toMatchObject({ claimed: 1, published: 1 });
    expect(pub.published[0]).toMatchObject({ eventType: 'DeliveryCompleted', organizationId: org });
    expect((await statusOf(key))?.status).toBe('PUBLISHED');
  });

  it('conteúdo do evento é imutável e eventos não são apagados', async () => {
    const key = `imm:${randomUUID()}`;
    await withSystemTransaction((tx) =>
      recordOutboxEvent(tx, { organizationId: org, eventType: 'ChargeCreated', aggregateType: 'charge', aggregateId: 'x', idempotencyKey: key }),
    );
    await expect(sql`update public.outbox_events set payload = '{"x":1}' where idempotency_key = ${key}`).rejects.toThrow(/imutável/);
    await expect(sql`delete from public.outbox_events where idempotency_key = ${key}`).rejects.toThrow(/não pode ser apagado/);
  });
});
