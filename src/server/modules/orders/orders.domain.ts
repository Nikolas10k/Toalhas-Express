import { BusinessRuleError } from '@/server/core/errors';
import { defineStateMachine } from '@/server/core/state-machine';

export const ORDER_STATUSES = [
  'DRAFT', 'NEW', 'CONFIRMED', 'PREPARING', 'READY', 'ROUTE_ASSIGNED', 'IN_TRANSIT',
  'DELIVERED', 'DELIVERY_PROBLEM', 'RESCHEDULED', 'CANCELLED', 'COMPLETED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type OrderType = 'DELIVERY' | 'COLLECTION' | 'DELIVERY_AND_COLLECTION';

/** Tabela da SPEC §6 — única fonte de transições válidas. */
export const orderStateMachine = defineStateMachine<OrderStatus>('order', {
  DRAFT: ['NEW', 'CANCELLED'],
  NEW: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'RESCHEDULED', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['ROUTE_ASSIGNED', 'RESCHEDULED', 'CANCELLED'],
  ROUTE_ASSIGNED: ['IN_TRANSIT', 'READY', 'RESCHEDULED'],
  IN_TRANSIT: ['DELIVERED', 'DELIVERY_PROBLEM'],
  DELIVERY_PROBLEM: ['RESCHEDULED', 'CANCELLED'],
  RESCHEDULED: ['CONFIRMED'],
  DELIVERED: ['COMPLETED'],
  CANCELLED: [],
  COMPLETED: [],
});

/**
 * Transições disparadas manualmente na tela de pedidos. As demais
 * (atribuição de rota, trânsito, entrega) pertencem aos fluxos de rota e
 * entrega (Fases 5 e 6) e só acontecem por eles.
 */
export const MANUAL_TRANSITIONS: Readonly<Partial<Record<OrderStatus, readonly OrderStatus[]>>> = {
  DRAFT: ['NEW', 'CANCELLED'],
  NEW: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'RESCHEDULED', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['RESCHEDULED', 'CANCELLED'],
  DELIVERY_PROBLEM: ['RESCHEDULED', 'CANCELLED'],
  RESCHEDULED: ['CONFIRMED'],
};

export function isManualTransition(from: OrderStatus, to: OrderStatus): boolean {
  return (MANUAL_TRANSITIONS[from] ?? []).includes(to);
}

/** Estados em que o estoque de entrega fica reservado para o pedido. */
export const RESERVED_STATUSES: ReadonlySet<OrderStatus> = new Set(['CONFIRMED', 'PREPARING', 'READY', 'ROUTE_ASSIGNED']);

/** Entrar em CONFIRMED/ROUTE_ASSIGNED reserva; cancelar, reagendar ou desatribuir (→ READY) libera. */
export function reservationEffect(from: OrderStatus, to: OrderStatus): 'reserve' | 'release' | 'none' {
  if (to === 'CONFIRMED' || to === 'ROUTE_ASSIGNED') return 'reserve';
  if (to === 'CANCELLED' || to === 'RESCHEDULED') return 'release';
  if (from === 'ROUTE_ASSIGNED' && to === 'READY') return 'release';
  return 'none';
}

/** Depois de sair para a rota, cancelamento só via DELIVERY_PROBLEM (a tabela já garante). */
export function assertCanCancel(status: OrderStatus): void {
  if (!orderStateMachine.canTransition(status, 'CANCELLED')) {
    throw new BusinessRuleError(
      status === 'IN_TRANSIT'
        ? 'Pedido em trânsito não pode ser cancelado diretamente: registre um problema na entrega.'
        : `Pedido com status ${status} não pode ser cancelado.`,
    );
  }
}

export function requiresReason(to: OrderStatus): boolean {
  return to === 'CANCELLED' || to === 'RESCHEDULED' || to === 'DELIVERY_PROBLEM';
}

export interface OrderItemInput {
  productId: string;
  deliveryQuantity: number;
  collectionQuantity: number;
}

export function validateItems(type: OrderType, items: OrderItemInput[]): void {
  if (items.length === 0) throw new BusinessRuleError('Informe ao menos um item.');
  const ids = new Set(items.map((i) => i.productId));
  if (ids.size !== items.length) throw new BusinessRuleError('Produto repetido nos itens.');
  for (const i of items) {
    if (i.deliveryQuantity < 0 || i.collectionQuantity < 0) throw new BusinessRuleError('Quantidades não podem ser negativas.');
    if (type === 'DELIVERY' && i.collectionQuantity > 0) throw new BusinessRuleError('Pedido só de entrega não tem quantidade de coleta.');
    if (type === 'COLLECTION' && i.deliveryQuantity > 0) throw new BusinessRuleError('Pedido só de coleta não tem quantidade de entrega.');
    if (i.deliveryQuantity === 0 && i.collectionQuantity === 0) throw new BusinessRuleError('Item sem quantidade.');
  }
}

// -----------------------------------------------------------------------------
// Datas (operação em America/Sao_Paulo; datas de agenda são DATE sem fuso)
// -----------------------------------------------------------------------------

export const TIMEZONE = 'America/Sao_Paulo';

/** YYYY-MM-DD de "hoje" no fuso da operação. */
export function todayInSaoPaulo(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 1 = segunda ... 7 = domingo (ISO). */
export function isoWeekday(isoDate: string): number {
  const day = new Date(`${isoDate}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Datas de ocorrência de uma regra dentro da janela [from, to]. */
export function occurrencesBetween(
  rule: { weekdays: number[]; startsOn: string; endsOn: string | null },
  from: string,
  to: string,
): string[] {
  const start = rule.startsOn > from ? rule.startsOn : from;
  const end = rule.endsOn && rule.endsOn < to ? rule.endsOn : to;
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (rule.weekdays.includes(isoWeekday(d))) out.push(d);
  }
  return out;
}

export function formatOrderNumber(n: number | string): string {
  return `P-${String(n).padStart(6, '0')}`;
}
