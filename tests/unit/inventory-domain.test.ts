import { describe, expect, it } from 'vitest';
import { BusinessRuleError } from '@/server/core/errors';
import {
  MOVEMENT_RULES,
  MOVEMENT_TYPES,
  reverseOf,
  summarizeStock,
  validateMovement,
  type MovementInput,
} from '@/server/modules/inventory/inventory.domain';

const base = { productId: 'p', quantity: 1 } as const;

describe('regras de movimento', () => {
  it('todo tipo tem ao menos uma transição e nenhuma é de um estado para ele mesmo', () => {
    for (const t of MOVEMENT_TYPES) {
      expect(MOVEMENT_RULES[t].length).toBeGreaterThan(0);
      for (const [f, to] of MOVEMENT_RULES[t]) expect(f).not.toBe(to);
    }
  });

  it('aceita transições da tabela e rejeita as demais', () => {
    expect(() => validateMovement({ ...base, type: 'RESERVATION', from: 'AVAILABLE', to: 'RESERVED' })).not.toThrow();
    expect(() => validateMovement({ ...base, type: 'RESERVATION', from: 'RESERVED', to: 'AVAILABLE' })).toThrow(BusinessRuleError);
    expect(() => validateMovement({ ...base, type: 'DELIVERY', from: 'AVAILABLE', to: 'WITH_CUSTOMER', customerId: 'c' })).toThrow(BusinessRuleError);
    expect(() => validateMovement({ ...base, type: 'STOCK_ENTRY', from: 'EXTERNAL', to: 'IN_ROUTE' })).toThrow(BusinessRuleError);
  });

  it('exige cliente, quantidade inteira positiva e motivo no ajuste', () => {
    expect(() => validateMovement({ ...base, type: 'COLLECTION', from: 'WITH_CUSTOMER', to: 'AWAITING_LAUNDRY' })).toThrow(/cliente/);
    expect(() => validateMovement({ ...base, quantity: 1.5, type: 'STOCK_ENTRY', from: 'EXTERNAL', to: 'AVAILABLE' })).toThrow(/inteiro/);
    expect(() => validateMovement({ ...base, quantity: -1, type: 'STOCK_ENTRY', from: 'EXTERNAL', to: 'AVAILABLE' })).toThrow();
    expect(() => validateMovement({ ...base, type: 'MANUAL_ADJUSTMENT', from: 'EXTERNAL', to: 'AVAILABLE', reason: 'x' })).toThrow(/motivo/);
  });

  it('estorno percorre a aresta inversa apenas para tipos estornáveis', () => {
    const entry = { productId: 'p', type: 'STOCK_ENTRY' as const, quantity: 5, from: 'EXTERNAL' as const, to: 'AVAILABLE' as const, customerId: null };
    const rev: MovementInput = { ...reverseOf(entry), reversesMovementId: 'm1' };
    expect(rev).toMatchObject({ from: 'AVAILABLE', to: 'EXTERNAL' });
    expect(() => validateMovement(rev)).not.toThrow();
    expect(() => validateMovement({ ...base, type: 'DELIVERY', from: 'WITH_CUSTOMER', to: 'IN_ROUTE', customerId: 'c', reversesMovementId: 'm' })).toThrow();
  });

  it('total é a soma dos estados', () => {
    const s = summarizeStock([
      { state: 'AVAILABLE', quantity: 900 },
      { state: 'WITH_CUSTOMER', quantity: 60 },
      { state: 'WITH_CUSTOMER', quantity: 40 },
    ]);
    expect(s.total).toBe(1000);
    expect(s.byState.WITH_CUSTOMER).toBe(100);
    expect(s.byState.LOST).toBe(0);
  });
});
