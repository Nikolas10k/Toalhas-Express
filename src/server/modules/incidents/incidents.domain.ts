import { defineStateMachine } from '@/server/core/state-machine';

export const INCIDENT_TYPES = [
  'NOT_RETURNED', 'IN_USE', 'DAMAGED', 'LOST', 'CUSTOMER_REFUSED', 'CUSTOMER_CLOSED', 'ADDRESS_PROBLEM', 'QUANTITY_DIVERGENCE', 'OTHER',
] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];

export const INCIDENT_STATUSES = ['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'CANCELLED'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const DAMAGE_CLASSES = ['TORN', 'STAINED', 'BURNED', 'FRAYED', 'WORN'] as const;
export type DamageClass = (typeof DAMAGE_CLASSES)[number];

export const DECISIONS = ['NO_ACTION', 'RETURN_TO_LAUNDRY', 'RETURN_TO_STOCK', 'DISCARD', 'CHARGE_CUSTOMER', 'REGISTER_LOSS'] as const;
export type Decision = (typeof DECISIONS)[number];

/** SPEC §7: OPEN → UNDER_REVIEW → RESOLVED | CANCELLED. */
export const incidentStateMachine = defineStateMachine<IncidentStatus>('incident', {
  OPEN: ['UNDER_REVIEW', 'RESOLVED', 'CANCELLED'],
  UNDER_REVIEW: ['OPEN', 'RESOLVED', 'CANCELLED'],
  RESOLVED: [],
  CANCELLED: [],
});

/** Problemas que o motorista registra numa parada (impedem o atendimento). */
export const STOP_PROBLEM_TYPES = ['CUSTOMER_REFUSED', 'CUSTOMER_CLOSED', 'ADDRESS_PROBLEM', 'OTHER'] as const;

export interface IncidentShape {
  type: IncidentType;
  quantity: number;
  productId: string | null;
  customerId: string | null;
  /**
   * Etapa da divergência: ficaram com o cliente (COLLECTION), voltaram na rota
   * (DELIVERY) ou não chegaram à base na conferência (RECEIVING).
   */
  stage?: 'COLLECTION' | 'DELIVERY' | 'RECEIVING' | null;
  /** Onde estão as toalhas da ocorrência: separadas para lavar (padrão) ou já marcadas como danificadas (inspeção). */
  location?: 'AWAITING_LAUNDRY' | 'DAMAGED' | null;
  /** Conferência: faltaram (MISSING) ou sobraram (EXTRA) toalhas. */
  direction?: 'MISSING' | 'EXTRA' | null;
}

/**
 * Decisões possíveis por tipo. Dano: as toalhas estão separadas (aguardando
 * lavagem) e o destino é decidido. Falta na coleta/perda: as toalhas estão
 * (no sistema) com o cliente; decide-se se seguem com ele ou viram perda.
 */
export function allowedDecisions(i: IncidentShape): Decision[] {
  const withStock = i.quantity > 0 && i.productId !== null;
  if (i.type === 'DAMAGED' && withStock) {
    // Dano achado na lavanderia (sem cliente): não há quem cobrar.
    return i.customerId ? ['RETURN_TO_LAUNDRY', 'RETURN_TO_STOCK', 'DISCARD', 'CHARGE_CUSTOMER'] : ['RETURN_TO_LAUNDRY', 'RETURN_TO_STOCK', 'DISCARD'];
  }
  // Falta na conferência: perda interna (entre o cliente e a base), nunca cobrada do cliente.
  if (i.type === 'QUANTITY_DIVERGENCE' && i.stage === 'RECEIVING') return withStock && i.direction === 'MISSING' ? ['NO_ACTION', 'REGISTER_LOSS'] : ['NO_ACTION'];
  const customerHolds = ['NOT_RETURNED', 'LOST', 'IN_USE'].includes(i.type) || (i.type === 'QUANTITY_DIVERGENCE' && i.stage === 'COLLECTION');
  if (customerHolds && withStock && i.customerId) return ['NO_ACTION', 'REGISTER_LOSS'];
  return ['NO_ACTION'];
}

export function formatIncidentNumber(n: number | string): string {
  return `OC-${String(n).padStart(5, '0')}`;
}
