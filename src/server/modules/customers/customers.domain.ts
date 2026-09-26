import { BusinessRuleError } from '@/server/core/errors';
import { defineStateMachine } from '@/server/core/state-machine';

export const CUSTOMER_STATUSES = ['pending', 'active', 'suspended', 'inactive'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export const customerStateMachine = defineStateMachine<CustomerStatus>('customer', {
  pending: ['active', 'inactive'],
  active: ['suspended', 'inactive'],
  suspended: ['active', 'inactive'],
  inactive: ['active'],
});

export type CustomerStatusAction = 'approve' | 'reject' | 'suspend' | 'reactivate' | 'inactivate';

const ACTION_TARGET: Record<CustomerStatusAction, CustomerStatus> = {
  approve: 'active',
  reject: 'inactive',
  suspend: 'suspended',
  reactivate: 'active',
  inactivate: 'inactive',
};

/** Ação só é válida a partir de estados específicos (approve só de pending etc.). */
const ACTION_FROM: Record<CustomerStatusAction, readonly CustomerStatus[]> = {
  approve: ['pending'],
  reject: ['pending'],
  suspend: ['active'],
  reactivate: ['suspended', 'inactive'],
  inactivate: ['active', 'suspended'],
};

export function resolveStatusAction(current: CustomerStatus, action: CustomerStatusAction): CustomerStatus {
  if (!ACTION_FROM[action].includes(current)) {
    throw new BusinessRuleError(`Ação "${action}" não é permitida para cliente com status ${current}.`, {
      from: current,
      action,
    });
  }
  const target = ACTION_TARGET[action];
  customerStateMachine.assertTransition(current, target);
  return target;
}

/** Clientes só podem fazer pedidos quando ativos (usado na Fase 4). */
export function canPlaceOrders(status: CustomerStatus): boolean {
  return status === 'active';
}

export const ADDRESS_KEYS = ['postalCode', 'street', 'number', 'complement', 'district', 'city', 'state'] as const;

export function addressChanged(before: Record<string, unknown>, patch: Record<string, unknown>): boolean {
  return ADDRESS_KEYS.some((k) => k in patch && patch[k] !== before[k]);
}

/** Endereço mínimo para tentar geocoding: rua + cidade/UF, ou CEP. */
export function hasGeocodableAddress(a: {
  street?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
}): boolean {
  return Boolean((a.street && a.city && a.state) || a.postalCode);
}

/** Diff raso para auditoria: só campos que mudaram. */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  patch: Partial<T>,
): { before: Partial<T>; after: Partial<T> } {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const [k, v] of Object.entries(patch) as [keyof T, T[keyof T]][]) {
    if (v === undefined) continue;
    if (JSON.stringify(before[k] ?? null) !== JSON.stringify(v ?? null)) {
      b[k] = before[k];
      a[k] = v;
    }
  }
  return { before: b, after: a };
}
