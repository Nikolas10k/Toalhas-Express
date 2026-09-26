import { describe, expect, it, vi } from 'vitest';
import { hmacSha256Hex } from '@/server/core/crypto';
import { ProviderError } from '@/server/core/errors';
import { EVENT_ID_HEADER, N8nOutboxPublisher, SIGNATURE_HEADER, signPayload } from '@/server/modules/outbox/n8n-publisher';
import type { OutboxEvent } from '@/server/modules/outbox/outbox.types';

const event: OutboxEvent = {
  id: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
  eventType: 'ChargeCreated',
  aggregateType: 'charge',
  aggregateId: 'c1',
  payload: { amount_cents: 50000 },
  occurredAt: new Date('2026-01-01T00:00:00Z'),
  correlationId: null,
  attempts: 1,
};

describe('N8nOutboxPublisher', () => {
  it('assina o corpo com HMAC e envia o event_id', async () => {
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
    await new N8nOutboxPublisher('https://n8n.example/webhook', 'segredo', fetchMock as unknown as typeof fetch).publish(event);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const body = init.body as string;
    const [t, v1] = headers[SIGNATURE_HEADER]!.split(',');
    const ts = Number(t!.slice(2));
    expect(v1).toBe(`v1=${hmacSha256Hex('segredo', `${ts}.${body}`)}`);
    expect(headers[EVENT_ID_HEADER]).toBe(event.id);
    expect(JSON.parse(body)).toMatchObject({ event_id: event.id, event_type: 'ChargeCreated' });
    expect(init.redirect).toBe('error');
  });

  it('converte falha HTTP e de rede em ProviderError repetível', async () => {
    const http500 = vi.fn(async () => new Response('x', { status: 500 }));
    await expect(new N8nOutboxPublisher('https://n', 's', http500 as unknown as typeof fetch).publish(event)).rejects.toBeInstanceOf(
      ProviderError,
    );
    const netErr = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(new N8nOutboxPublisher('https://n', 's', netErr as unknown as typeof fetch).publish(event)).rejects.toMatchObject({
      retryable: true,
    });
  });

  it('signPayload é determinístico', () => {
    expect(signPayload('s', '{}', 1)).toBe(`t=1,v1=${hmacSha256Hex('s', '1.{}')}`);
  });
});
