import { BusinessRuleError } from '@/server/core/errors';
import { defineStateMachine } from '@/server/core/state-machine';

/**
 * Higienização de enxoval do cliente (hotéis/spas). A roupa é do cliente:
 * nunca entra no estoque de toalhas. A OS registra o rol da coleta, a
 * conferência na saída da lavanderia e a entrega.
 */
export const SERVICE_ORDER_STATUSES = ['COLLECTED', 'READY', 'DELIVERED', 'CANCELLED'] as const;
export type ServiceOrderStatus = (typeof SERVICE_ORDER_STATUSES)[number];

export const serviceOrderStateMachine = defineStateMachine<ServiceOrderStatus>('linen_service_order', {
  COLLECTED: ['READY', 'CANCELLED'],
  READY: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
});

export function formatServiceOrderNumber(n: number | string): string {
  return `OS-${String(n).padStart(5, '0')}`;
}

export interface ReadyLine {
  name: string;
  collected: number;
  returned: number;
}

/** Peças a menos na saída exigem explicação (a roupa é do cliente). Peças a mais não existem. */
export function readyDivergences(lines: ReadyLine[], note: string | null): { missing: number; lines: (ReadyLine & { missing: number })[] } {
  const out: (ReadyLine & { missing: number })[] = [];
  let missing = 0;
  for (const l of lines) {
    if (l.returned > l.collected) throw new BusinessRuleError(`${l.name}: saíram ${l.returned}, mas só ${l.collected} foram coletadas.`);
    const m = l.collected - l.returned;
    if (m > 0) {
      out.push({ ...l, missing: m });
      missing += m;
    }
  }
  if (missing > 0 && (!note || note.trim().length < 5)) {
    throw new BusinessRuleError('Faltam peças do cliente: explique o que aconteceu (mínimo 5 caracteres).');
  }
  return { missing, lines: out };
}

/** Distribui a quantidade entregue entre as OS (mais antiga primeiro). */
export function distributeDelivered(orders: { id: string; returned: number }[], delivered: number): Map<string, number> {
  const out = new Map<string, number>();
  let left = delivered;
  for (const o of orders) {
    const q = Math.min(o.returned, left);
    out.set(o.id, q);
    left -= q;
  }
  return out;
}
