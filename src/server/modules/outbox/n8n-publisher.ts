import 'server-only';
import { hmacSha256Hex } from '@/server/core/crypto';
import { ProviderError } from '@/server/core/errors';
import type { OutboxEvent, OutboxPublisher } from './outbox.types';

export const SIGNATURE_HEADER = 'x-toalhas-signature';
export const EVENT_ID_HEADER = 'x-toalhas-event-id';

/**
 * Assinatura no formato `t=<epoch>,v1=<hex>` com HMAC-SHA256 sobre
 * `${t}.${body}`. O n8n deve validar a assinatura, rejeitar timestamps com
 * mais de 5 min e deduplicar por event_id.
 */
export function signPayload(secret: string, body: string, timestamp: number): string {
  return `t=${timestamp},v1=${hmacSha256Hex(secret, `${timestamp}.${body}`)}`;
}

export class N8nOutboxPublisher implements OutboxPublisher {
  readonly name = 'n8n';

  constructor(
    private readonly url: string,
    private readonly secret: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 10_000,
  ) {}

  async publish(event: OutboxEvent): Promise<void> {
    const body = JSON.stringify({
      event_id: event.id,
      event_type: event.eventType,
      organization_id: event.organizationId,
      aggregate_type: event.aggregateType,
      aggregate_id: event.aggregateId,
      occurred_at: event.occurredAt.toISOString(),
      correlation_id: event.correlationId,
      payload: event.payload,
    });
    const timestamp = Math.floor(Date.now() / 1000);
    let res: Response;
    try {
      res = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [SIGNATURE_HEADER]: signPayload(this.secret, body, timestamp),
          [EVENT_ID_HEADER]: event.id,
        },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new ProviderError('n8n', 'Falha de rede ao publicar evento', { cause: err });
    }
    if (!res.ok) {
      throw new ProviderError('n8n', `Resposta HTTP ${res.status} ao publicar evento`);
    }
  }
}
