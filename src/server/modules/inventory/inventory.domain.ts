import { BusinessRuleError } from '@/server/core/errors';
import type { Permission } from '@/server/authz/permissions';

export const INVENTORY_STATES = [
  'AVAILABLE',
  'RESERVED',
  'IN_ROUTE',
  'WITH_CUSTOMER',
  'AWAITING_LAUNDRY',
  'IN_LAUNDRY',
  'IN_INSPECTION',
  'DAMAGED',
  'LOST',
  'DISCARDED',
] as const;
export type InventoryState = (typeof INVENTORY_STATES)[number];
export type LedgerState = InventoryState | 'EXTERNAL';

export const MOVEMENT_TYPES = [
  'STOCK_ENTRY',
  'RESERVATION',
  'RESERVATION_RELEASE',
  'DELIVERY_DISPATCH',
  'DELIVERY',
  'COLLECTION',
  'LAUNDRY_ENTRY',
  'LAUNDRY_EXIT',
  'TRANSFER',
  'DAMAGE',
  'LOSS',
  'DISCARD',
  'MANUAL_ADJUSTMENT',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

type Edge = readonly [LedgerState, LedgerState];

/**
 * Única fonte das transições válidas por tipo de movimento. Qualquer
 * combinação fora desta tabela é rejeitada antes de tocar o banco.
 */
const PHYSICAL: InventoryState[] = ['AVAILABLE', 'RESERVED', 'IN_ROUTE', 'WITH_CUSTOMER', 'AWAITING_LAUNDRY', 'IN_LAUNDRY', 'IN_INSPECTION'];
const allTo = (from: readonly LedgerState[], to: LedgerState): Edge[] => from.map((f) => [f, to] as const);

export const MOVEMENT_RULES: Record<MovementType, readonly Edge[]> = {
  STOCK_ENTRY: [['EXTERNAL', 'AVAILABLE']],
  RESERVATION: [['AVAILABLE', 'RESERVED']],
  RESERVATION_RELEASE: [['RESERVED', 'AVAILABLE']],
  DELIVERY_DISPATCH: [['RESERVED', 'IN_ROUTE'], ['AVAILABLE', 'IN_ROUTE']],
  DELIVERY: [['IN_ROUTE', 'WITH_CUSTOMER']],
  COLLECTION: [['WITH_CUSTOMER', 'AWAITING_LAUNDRY'], ['WITH_CUSTOMER', 'IN_ROUTE']],
  LAUNDRY_ENTRY: [['AWAITING_LAUNDRY', 'IN_LAUNDRY'], ['IN_ROUTE', 'IN_LAUNDRY']],
  LAUNDRY_EXIT: [['IN_LAUNDRY', 'IN_INSPECTION']],
  TRANSFER: [
    ['IN_INSPECTION', 'AVAILABLE'],
    ['IN_ROUTE', 'AVAILABLE'],
    ['IN_ROUTE', 'AWAITING_LAUNDRY'],
    ['DAMAGED', 'AWAITING_LAUNDRY'],
    ['DAMAGED', 'AVAILABLE'],
    ['LOST', 'AVAILABLE'],
    ['AVAILABLE', 'AWAITING_LAUNDRY'],
    // Lote de lavanderia cancelado antes de lavar: toalhas voltam para a fila.
    ['IN_LAUNDRY', 'AWAITING_LAUNDRY'],
  ],
  DAMAGE: allTo(PHYSICAL, 'DAMAGED'),
  LOSS: allTo(PHYSICAL, 'LOST'),
  DISCARD: [['DAMAGED', 'DISCARDED'], ['IN_INSPECTION', 'DISCARDED'], ['AVAILABLE', 'DISCARDED'], ['LOST', 'DISCARDED']],
  // Ajuste manual: entra/sai do sistema (EXTERNAL) em qualquer estado contado.
  MANUAL_ADJUSTMENT: [
    ...INVENTORY_STATES.map((s) => ['EXTERNAL', s] as const),
    ...INVENTORY_STATES.map((s) => [s, 'EXTERNAL'] as const),
  ],
};

/** Permissão exigida por tipo (além do RLS). Ajuste grande exige step-up. */
export const MOVEMENT_PERMISSION: Record<MovementType, Permission> = {
  STOCK_ENTRY: 'inventory.move',
  RESERVATION: 'order.update',
  RESERVATION_RELEASE: 'order.update',
  DELIVERY_DISPATCH: 'operation.execute',
  DELIVERY: 'operation.execute',
  COLLECTION: 'operation.execute',
  LAUNDRY_ENTRY: 'laundry.manage',
  LAUNDRY_EXIT: 'laundry.manage',
  TRANSFER: 'inventory.move',
  DAMAGE: 'inventory.move',
  LOSS: 'inventory.move',
  DISCARD: 'inventory.move',
  MANUAL_ADJUSTMENT: 'inventory.adjust',
};

/** Acima deste total por operação o ajuste manual exige inventory.adjust_large (step-up). */
export const LARGE_ADJUSTMENT_THRESHOLD = 50;

export interface MovementInput {
  productId: string;
  type: MovementType;
  quantity: number;
  from: LedgerState;
  to: LedgerState;
  customerId?: string | null;
  orderId?: string | null;
  routeId?: string | null;
  routeStopId?: string | null;
  driverId?: string | null;
  laundryBatchId?: string | null;
  reason?: string | null;
  allowNegative?: boolean;
  reversesMovementId?: string | null;
  idempotencyKey?: string | null;
  occurredAt?: Date;
  /**
   * Permissão que autoriza este movimento quando ele faz parte de um fluxo
   * operacional já autorizado (ex.: retorno das toalhas não entregues ao
   * finalizar a rota). Só serviços internos definem; a API de estoque nunca.
   */
  authorizedBy?: Permission;
}

export function validateMovement(m: MovementInput): void {
  if (!Number.isSafeInteger(m.quantity) || m.quantity <= 0) {
    throw new BusinessRuleError('Quantidade deve ser um número inteiro maior que zero.');
  }
  const rules = MOVEMENT_RULES[m.type];
  // Estorno percorre a aresta inversa de uma transição válida do mesmo tipo.
  const allowed = m.reversesMovementId
    ? REVERSIBLE_TYPES.includes(m.type) && rules.some(([f, t]) => f === m.to && t === m.from)
    : rules.some(([f, t]) => f === m.from && t === m.to);
  if (!allowed) throw new BusinessRuleError(`Movimento ${m.type} não permite ${m.from} → ${m.to}.`, { type: m.type, from: m.from, to: m.to });
  const touchesCustomer = m.from === 'WITH_CUSTOMER' || m.to === 'WITH_CUSTOMER';
  if (touchesCustomer && !m.customerId) throw new BusinessRuleError('Informe o cliente para movimentos com saldo de cliente.');
  if (m.type === 'MANUAL_ADJUSTMENT' && (!m.reason || m.reason.trim().length < 5)) {
    throw new BusinessRuleError('Ajuste manual exige motivo (mínimo 5 caracteres).');
  }
}

/** Estorno: mesmo tipo e quantidade, estados invertidos. */
export function reverseOf(m: { productId: string; type: MovementType; quantity: number; from: LedgerState; to: LedgerState; customerId: string | null }) {
  return { productId: m.productId, type: m.type, quantity: m.quantity, from: m.to, to: m.from, customerId: m.customerId };
}

export const REVERSIBLE_TYPES: readonly MovementType[] = ['STOCK_ENTRY', 'MANUAL_ADJUSTMENT', 'TRANSFER', 'DAMAGE', 'LOSS'];

export const STATE_LABEL: Record<LedgerState, string> = {
  EXTERNAL: 'Fora do sistema',
  AVAILABLE: 'Disponível',
  RESERVED: 'Reservado',
  IN_ROUTE: 'Em rota',
  WITH_CUSTOMER: 'Com clientes',
  AWAITING_LAUNDRY: 'Aguardando lavagem',
  IN_LAUNDRY: 'Em lavagem',
  IN_INSPECTION: 'Em inspeção',
  DAMAGED: 'Danificado',
  LOST: 'Perdido',
  DISCARDED: 'Descartado',
};

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  STOCK_ENTRY: 'Entrada de estoque',
  RESERVATION: 'Reserva',
  RESERVATION_RELEASE: 'Liberação de reserva',
  DELIVERY_DISPATCH: 'Saída para rota',
  DELIVERY: 'Entrega',
  COLLECTION: 'Coleta',
  LAUNDRY_ENTRY: 'Entrada na lavanderia',
  LAUNDRY_EXIT: 'Saída da lavanderia',
  TRANSFER: 'Transferência',
  DAMAGE: 'Dano',
  LOSS: 'Perda',
  DISCARD: 'Descarte',
  MANUAL_ADJUSTMENT: 'Ajuste manual',
};

export interface ProductStock {
  total: number;
  byState: Record<InventoryState, number>;
}

/** Total = soma de todos os estados contados (EXTERNAL fica de fora). */
export function summarizeStock(rows: { state: InventoryState; quantity: number }[]): ProductStock {
  const byState = Object.fromEntries(INVENTORY_STATES.map((s) => [s, 0])) as Record<InventoryState, number>;
  for (const r of rows) byState[r.state] += r.quantity;
  return { total: Object.values(byState).reduce((a, b) => a + b, 0), byState };
}
