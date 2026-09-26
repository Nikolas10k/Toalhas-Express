import { describe, expect, it } from 'vitest';
import { BusinessRuleError } from '@/server/core/errors';
import {
  MANUAL_TRANSITIONS,
  ORDER_STATUSES,
  addDays,
  assertCanCancel,
  formatOrderNumber,
  isManualTransition,
  isoWeekday,
  occurrencesBetween,
  orderStateMachine,
  requiresReason,
  reservationEffect,
  todayInSaoPaulo,
  validateItems,
  type OrderStatus,
} from '@/server/modules/orders/orders.domain';

/** Tabela literal da SPEC §6 — o teste falha se a máquina divergir. */
const SPEC_TABLE: Record<OrderStatus, OrderStatus[]> = {
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
};

describe('máquina de estados de pedidos', () => {
  it('aceita exatamente as transições da tabela (todas as 144 combinações)', () => {
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        expect(orderStateMachine.canTransition(from, to), `${from} → ${to}`).toBe(SPEC_TABLE[from].includes(to));
      }
    }
  });

  it('transições manuais são subconjunto da tabela e excluem fluxo de rota/entrega', () => {
    for (const [from, tos] of Object.entries(MANUAL_TRANSITIONS) as [OrderStatus, OrderStatus[]][]) {
      for (const to of tos) expect(orderStateMachine.canTransition(from, to)).toBe(true);
    }
    expect(isManualTransition('READY', 'ROUTE_ASSIGNED')).toBe(false);
    expect(isManualTransition('ROUTE_ASSIGNED', 'IN_TRANSIT')).toBe(false);
    expect(isManualTransition('IN_TRANSIT', 'DELIVERED')).toBe(false);
    expect(isManualTransition('DELIVERED', 'COMPLETED')).toBe(false);
    expect(isManualTransition('NEW', 'CONFIRMED')).toBe(true);
  });

  it('estados finais não saem', () => {
    expect(orderStateMachine.canTransition('CANCELLED', 'NEW')).toBe(false);
    expect(orderStateMachine.canTransition('COMPLETED', 'DELIVERED')).toBe(false);
  });

  it('cancelamento em trânsito orienta registrar problema', () => {
    expect(() => assertCanCancel('IN_TRANSIT')).toThrow(/problema na entrega/);
    expect(() => assertCanCancel('DELIVERED')).toThrow(BusinessRuleError);
    expect(() => assertCanCancel('CONFIRMED')).not.toThrow();
  });

  it('motivo obrigatório em cancelar, reagendar e problema', () => {
    expect(requiresReason('CANCELLED')).toBe(true);
    expect(requiresReason('RESCHEDULED')).toBe(true);
    expect(requiresReason('DELIVERY_PROBLEM')).toBe(true);
    expect(requiresReason('CONFIRMED')).toBe(false);
  });
});

describe('efeito de reserva', () => {
  it('reserva ao confirmar e ao atribuir rota', () => {
    expect(reservationEffect('NEW', 'CONFIRMED')).toBe('reserve');
    expect(reservationEffect('RESCHEDULED', 'CONFIRMED')).toBe('reserve');
    expect(reservationEffect('READY', 'ROUTE_ASSIGNED')).toBe('reserve');
  });
  it('libera ao cancelar, reagendar ou desatribuir', () => {
    expect(reservationEffect('CONFIRMED', 'CANCELLED')).toBe('release');
    expect(reservationEffect('READY', 'RESCHEDULED')).toBe('release');
    expect(reservationEffect('ROUTE_ASSIGNED', 'READY')).toBe('release');
  });
  it('não mexe no estoque nas etapas intermediárias', () => {
    expect(reservationEffect('CONFIRMED', 'PREPARING')).toBe('none');
    expect(reservationEffect('PREPARING', 'READY')).toBe('none');
    expect(reservationEffect('DRAFT', 'NEW')).toBe('none');
  });
});

describe('validação de itens', () => {
  const p = (productId: string, d: number, c: number) => ({ productId, deliveryQuantity: d, collectionQuantity: c });
  it('rejeita lista vazia, produto repetido e item zerado', () => {
    expect(() => validateItems('DELIVERY', [])).toThrow(BusinessRuleError);
    expect(() => validateItems('DELIVERY', [p('a', 1, 0), p('a', 2, 0)])).toThrow(/repetido/);
    expect(() => validateItems('DELIVERY_AND_COLLECTION', [p('a', 0, 0)])).toThrow(/sem quantidade/);
  });
  it('respeita o tipo do pedido', () => {
    expect(() => validateItems('DELIVERY', [p('a', 1, 1)])).toThrow(/coleta/);
    expect(() => validateItems('COLLECTION', [p('a', 1, 0)])).toThrow(/entrega/);
    expect(() => validateItems('DELIVERY_AND_COLLECTION', [p('a', 3, 2), p('b', 0, 1)])).not.toThrow();
  });
});

describe('datas da operação', () => {
  it('hoje em São Paulo vira o dia 3h depois de UTC', () => {
    expect(todayInSaoPaulo(new Date('2026-09-27T02:59:00Z'))).toBe('2026-09-26');
    expect(todayInSaoPaulo(new Date('2026-09-27T03:00:00Z'))).toBe('2026-09-27');
  });
  it('soma dias atravessando mês e ano', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('dia da semana ISO', () => {
    expect(isoWeekday('2026-09-28')).toBe(1); // segunda
    expect(isoWeekday('2026-09-27')).toBe(7); // domingo
  });
  it('ocorrências respeitam dias, início e fim da regra', () => {
    const rule = { weekdays: [1, 3, 5], startsOn: '2026-09-29', endsOn: '2026-10-09' };
    expect(occurrencesBetween(rule, '2026-09-26', '2026-10-31')).toEqual([
      '2026-09-30', '2026-10-02', '2026-10-05', '2026-10-07', '2026-10-09',
    ]);
    expect(occurrencesBetween({ ...rule, endsOn: null }, '2026-10-12', '2026-10-13')).toEqual(['2026-10-12']);
    expect(occurrencesBetween(rule, '2026-11-01', '2026-11-30')).toEqual([]);
  });
  it('número do pedido formatado', () => {
    expect(formatOrderNumber(123)).toBe('P-000123');
    expect(formatOrderNumber('1234567')).toBe('P-1234567');
  });
});
