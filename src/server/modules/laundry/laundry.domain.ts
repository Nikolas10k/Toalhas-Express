import { BusinessRuleError } from '@/server/core/errors';
import { defineStateMachine } from '@/server/core/state-machine';

export const LAUNDRY_STATUSES = ['WAITING', 'WASHING', 'DRYING', 'FOLDING', 'INSPECTION', 'COMPLETED', 'CANCELLED'] as const;
export type LaundryStatus = (typeof LAUNDRY_STATUSES)[number];

/** SPEC §5: WAITING → WASHING → DRYING → FOLDING → INSPECTION → COMPLETED. Cancelar só antes de lavar. */
export const laundryStateMachine = defineStateMachine<LaundryStatus>('laundry_batch', {
  WAITING: ['WASHING', 'CANCELLED'],
  WASHING: ['DRYING'],
  DRYING: ['FOLDING'],
  FOLDING: ['INSPECTION'],
  INSPECTION: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
});

/** Etapas avançadas por botão; a conclusão exige o resultado da inspeção. */
export const MANUAL_STEPS: ReadonlySet<LaundryStatus> = new Set(['WASHING', 'DRYING', 'FOLDING', 'INSPECTION']);

export interface InspectionLine {
  quantity: number;
  available: number;
  damaged: number;
  discarded: number;
}

/** Toda toalha do lote recebe um destino: disponível + danificada + descarte = quantidade. */
export function assertInspectionCloses(name: string, l: InspectionLine): void {
  const total = l.available + l.damaged + l.discarded;
  if (total !== l.quantity) {
    throw new BusinessRuleError(`${name}: o lote tem ${l.quantity} e a inspeção somou ${total}. Toda toalha precisa de um destino.`);
  }
}

export function formatBatchNumber(n: number | string): string {
  return `LV-${String(n).padStart(5, '0')}`;
}
