import { describe, expect, it } from 'vitest';
import { assertInspectionCloses, formatBatchNumber, LAUNDRY_STATUSES, laundryStateMachine } from '@/server/modules/laundry/laundry.domain';
import { MOVEMENT_RULES } from '@/server/modules/inventory/inventory.domain';

describe('lotes de lavanderia (SPEC §5)', () => {
  const table: Record<string, string[]> = {
    WAITING: ['WASHING', 'CANCELLED'],
    WASHING: ['DRYING'],
    DRYING: ['FOLDING'],
    FOLDING: ['INSPECTION'],
    INSPECTION: ['COMPLETED'],
    COMPLETED: [],
    CANCELLED: [],
  };
  it('aceita exatamente a sequência da SPEC; cancelar só antes de lavar', () => {
    for (const f of LAUNDRY_STATUSES) for (const t of LAUNDRY_STATUSES) expect(laundryStateMachine.canTransition(f, t), `${f}→${t}`).toBe(table[f]!.includes(t));
  });
  it('inspeção fecha com a quantidade do lote', () => {
    expect(() => assertInspectionCloses('Toalha', { quantity: 10, available: 7, damaged: 2, discarded: 1 })).not.toThrow();
    expect(() => assertInspectionCloses('Toalha', { quantity: 10, available: 7, damaged: 2, discarded: 0 })).toThrow(/somou 9/);
    expect(() => assertInspectionCloses('Toalha', { quantity: 10, available: 11, damaged: 0, discarded: 0 })).toThrow();
  });
  it('ledger tem as transições da lavanderia (entrada, saída para inspeção, retorno de lote cancelado)', () => {
    expect(MOVEMENT_RULES.LAUNDRY_ENTRY).toContainEqual(['AWAITING_LAUNDRY', 'IN_LAUNDRY']);
    expect(MOVEMENT_RULES.LAUNDRY_EXIT).toContainEqual(['IN_LAUNDRY', 'IN_INSPECTION']);
    expect(MOVEMENT_RULES.TRANSFER).toContainEqual(['IN_LAUNDRY', 'AWAITING_LAUNDRY']);
    expect(MOVEMENT_RULES.TRANSFER).toContainEqual(['IN_INSPECTION', 'AVAILABLE']);
    expect(MOVEMENT_RULES.DISCARD).toContainEqual(['IN_INSPECTION', 'DISCARDED']);
  });
  it('número do lote', () => expect(formatBatchNumber(7)).toBe('LV-00007'));
});
