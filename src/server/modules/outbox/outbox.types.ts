export interface OutboxEvent {
  id: string;
  organizationId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  correlationId: string | null;
  attempts: number;
}

/**
 * Destino externo dos eventos (n8n). Deve ser idempotente do lado de lá via
 * `event.id` — o mesmo evento pode ser entregue mais de uma vez.
 */
export interface OutboxPublisher {
  readonly name: string;
  publish(event: OutboxEvent): Promise<void>;
}
