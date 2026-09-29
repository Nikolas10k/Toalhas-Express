import { describe, expect, it } from 'vitest';
import { BusinessRuleError } from '@/server/core/errors';
import { distributeDelivered, formatServiceOrderNumber, readyDivergences, SERVICE_ORDER_STATUSES, serviceOrderStateMachine } from '@/server/modules/linen/linen.domain';

describe('OS de enxoval', () => {
  it('máquina de estados: coletado → pronto → entregue; cancelar só antes de lavar', () => {
    const table: Record<string, string[]> = { COLLECTED: ['READY', 'CANCELLED'], READY: ['DELIVERED'], DELIVERED: [], CANCELLED: [] };
    for (const f of SERVICE_ORDER_STATUSES) for (const t of SERVICE_ORDER_STATUSES) expect(serviceOrderStateMachine.canTransition(f, t), `${f}→${t}`).toBe(table[f]!.includes(t));
    expect(formatServiceOrderNumber(7)).toBe('OS-00007');
  });

  it('conferência da saída: falta exige explicação; sobra é impossível', () => {
    expect(readyDivergences([{ name: 'Lençol', collected: 10, returned: 10 }], null)).toEqual({ missing: 0, lines: [] });
    expect(() => readyDivergences([{ name: 'Lençol', collected: 10, returned: 9 }], null)).toThrow(BusinessRuleError);
    expect(readyDivergences([{ name: 'Lençol', collected: 10, returned: 9 }], 'Rasgou na calandra').missing).toBe(1);
    expect(() => readyDivergences([{ name: 'Lençol', collected: 10, returned: 11 }], 'x'.repeat(10))).toThrow(/só 10 foram coletadas/);
  });

  it('entrega distribuída entre OS da mais antiga para a mais nova', () => {
    expect([...distributeDelivered([{ id: 'a', returned: 30 }, { id: 'b', returned: 20 }], 40)]).toEqual([['a', 30], ['b', 10]]);
    expect([...distributeDelivered([{ id: 'a', returned: 30 }], 0)]).toEqual([['a', 0]]);
  });
});
