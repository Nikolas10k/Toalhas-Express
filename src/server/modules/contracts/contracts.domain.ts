import { BusinessRuleError } from '@/server/core/errors';
import { defineStateMachine } from '@/server/core/state-machine';

/**
 * Regras de cálculo dos contratos. Funções puras, só com inteiros (centavos),
 * testáveis sem banco. O financeiro (Fase 9) gera os lançamentos a partir
 * daqui; a tela de simulação usa exatamente as mesmas funções.
 */

export const CONTRACT_STATUSES = ['DRAFT', 'ACTIVE', 'SUSPENDED', 'ENDED', 'CANCELLED'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const BILLING_TYPES = ['MONTHLY_FIXED', 'PER_DELIVERY', 'PER_QUANTITY', 'HYBRID', 'CUSTOM'] as const;
export type BillingType = (typeof BILLING_TYPES)[number];

export const contractStateMachine = defineStateMachine<ContractStatus>('contract', {
  DRAFT: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['SUSPENDED', 'ENDED'],
  SUSPENDED: ['ACTIVE', 'ENDED'],
  ENDED: [],
  CANCELLED: [],
});

export interface ContractTerms {
  billingType: BillingType;
  startsOn: string;
  endsOn: string | null;
  dueDay: number;
  monthlyFeeCents: number;
  perDeliveryFeeCents: number;
  discountBp: number;
  prorateFirstMonth: boolean;
  items: ContractItemTerms[];
}

export interface ContractItemTerms {
  productId: string;
  productName: string;
  contractedQuantity: number;
  franchiseQuantity: number;
  unitPriceCents: number;
  excessPriceCents: number;
  lossPriceCents: number | null;
  damagePriceCents: number | null;
}

/** O que precisa estar preenchido para cada tipo de cobrança (validado ao ativar e ao salvar). */
export function assertTermsConsistent(t: Pick<ContractTerms, 'billingType' | 'monthlyFeeCents' | 'perDeliveryFeeCents' | 'items'>): void {
  const ids = t.items.map((i) => i.productId);
  if (new Set(ids).size !== ids.length) throw new BusinessRuleError('Produto repetido nos itens do contrato.');
  for (const i of t.items) {
    if (i.franchiseQuantity > 0 && t.billingType !== 'HYBRID' && t.billingType !== 'CUSTOM') {
      throw new BusinessRuleError('Franquia só se aplica a contratos híbridos (mensalidade + excedente).');
    }
  }
  switch (t.billingType) {
    case 'MONTHLY_FIXED':
      if (t.monthlyFeeCents <= 0) throw new BusinessRuleError('Informe o valor da mensalidade.');
      return;
    case 'PER_DELIVERY':
      if (t.perDeliveryFeeCents <= 0) throw new BusinessRuleError('Informe o valor por entrega.');
      return;
    case 'PER_QUANTITY':
      if (t.items.length === 0 || t.items.some((i) => i.unitPriceCents <= 0)) throw new BusinessRuleError('Informe o preço por peça de cada produto.');
      return;
    case 'HYBRID':
      if (t.monthlyFeeCents <= 0) throw new BusinessRuleError('Informe a mensalidade do contrato híbrido.');
      if (t.items.length === 0 || t.items.some((i) => i.excessPriceCents <= 0)) throw new BusinessRuleError('Informe franquia e preço de excedente de cada produto.');
      return;
    case 'CUSTOM':
      return;
  }
}

// -----------------------------------------------------------------------------
// Datas
// -----------------------------------------------------------------------------

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthBounds(month: string): { from: string; to: string } {
  return { from: `${month}-01`, to: `${month}-${String(daysInMonth(month)).padStart(2, '0')}` };
}

/** Vencimento do mês de referência: dia contratado no mês seguinte (dia ≤ 28 sempre existe). */
export function dueDateFor(month: string, dueDay: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const next = new Date(Date.UTC(y, m, dueDay));
  return next.toISOString().slice(0, 10);
}

function dayDiffInclusive(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** Dias do mês cobertos pela vigência (0 se fora). */
export function coveredDays(month: string, startsOn: string, endsOn: string | null): number {
  const { from, to } = monthBounds(month);
  const start = startsOn > from ? startsOn : from;
  const end = endsOn && endsOn < to ? endsOn : to;
  return end < start ? 0 : dayDiffInclusive(start, end);
}

/** Divisão inteira com arredondamento meio-para-cima (valores não negativos). */
export function roundDiv(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0 || numerator < 0) {
    throw new RangeError('roundDiv: inteiros não negativos esperados');
  }
  return Math.floor((numerator * 2 + denominator) / (denominator * 2));
}

function mul(a: number, b: number): number {
  const r = a * b;
  if (!Number.isSafeInteger(r)) throw new RangeError('Valor fora do limite seguro.');
  return r;
}

// -----------------------------------------------------------------------------
// Cálculo do mês
// -----------------------------------------------------------------------------

export interface MonthUsage {
  /** Entregas (paradas atendidas com entrega > 0) no mês. */
  deliveries: number;
  /** Toalhas entregues por produto no mês. */
  deliveredByProduct: Record<string, number>;
}

export type LineKind = 'MONTHLY_FEE' | 'DELIVERY_FEE' | 'QUANTITY' | 'EXCESS';

export interface BillingLine {
  kind: LineKind;
  description: string;
  productId: string | null;
  quantity: number;
  unitCents: number;
  amountCents: number;
}

export interface MonthBilling {
  month: string;
  dueDate: string;
  coveredDays: number;
  lines: BillingLine[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  /** CUSTOM: sem cálculo automático; o financeiro lança manualmente. */
  requiresManual: boolean;
}

/**
 * Valor do mês de referência (AAAA-MM). Mensalidade proporcional aos dias de
 * vigência quando o contrato começa/termina no meio do mês (se configurado);
 * uso variável conta só o que foi efetivamente entregue.
 */
export function computeMonthBilling(t: ContractTerms, month: string, usage: MonthUsage): MonthBilling {
  const days = coveredDays(month, t.startsOn, t.endsOn);
  const total = daysInMonth(month);
  const lines: BillingLine[] = [];
  const base = { month, dueDate: dueDateFor(month, t.dueDay), coveredDays: days };
  if (days === 0) return { ...base, lines, subtotalCents: 0, discountCents: 0, totalCents: 0, requiresManual: false };

  const fee = (label: string) => {
    if (t.monthlyFeeCents <= 0) return;
    const partial = days < total && t.prorateFirstMonth;
    const amount = partial ? roundDiv(mul(t.monthlyFeeCents, days), total) : t.monthlyFeeCents;
    lines.push({
      kind: 'MONTHLY_FEE',
      description: partial ? `${label} proporcional (${days}/${total} dias)` : label,
      productId: null,
      quantity: 1,
      unitCents: amount,
      amountCents: amount,
    });
  };

  switch (t.billingType) {
    case 'MONTHLY_FIXED':
      fee('Mensalidade');
      break;
    case 'PER_DELIVERY':
      if (usage.deliveries > 0) {
        lines.push({ kind: 'DELIVERY_FEE', description: 'Entregas no mês', productId: null, quantity: usage.deliveries, unitCents: t.perDeliveryFeeCents, amountCents: mul(usage.deliveries, t.perDeliveryFeeCents) });
      }
      break;
    case 'PER_QUANTITY':
      for (const i of t.items) {
        const q = usage.deliveredByProduct[i.productId] ?? 0;
        if (q > 0) lines.push({ kind: 'QUANTITY', description: `${i.productName} entregues`, productId: i.productId, quantity: q, unitCents: i.unitPriceCents, amountCents: mul(q, i.unitPriceCents) });
      }
      break;
    case 'HYBRID':
      fee('Mensalidade (franquia inclusa)');
      for (const i of t.items) {
        const excess = Math.max(0, (usage.deliveredByProduct[i.productId] ?? 0) - i.franchiseQuantity);
        if (excess > 0) {
          lines.push({ kind: 'EXCESS', description: `${i.productName}: ${excess} acima da franquia de ${i.franchiseQuantity}`, productId: i.productId, quantity: excess, unitCents: i.excessPriceCents, amountCents: mul(excess, i.excessPriceCents) });
        }
      }
      break;
    case 'CUSTOM':
      fee('Mensalidade');
      break;
  }

  const subtotal = lines.reduce((a, l) => a + l.amountCents, 0);
  const discount = t.discountBp > 0 ? roundDiv(mul(subtotal, t.discountBp), 10_000) : 0;
  return { ...base, lines, subtotalCents: subtotal, discountCents: discount, totalCents: subtotal - discount, requiresManual: t.billingType === 'CUSTOM' };
}

/** Preço de perda/dano do contrato; sem valor no contrato, o preço de reposição do produto. */
export function lossDamagePrice(item: Pick<ContractItemTerms, 'lossPriceCents' | 'damagePriceCents'> | null, kind: 'LOSS' | 'DAMAGE', replacementCents: number): number {
  const v = kind === 'LOSS' ? item?.lossPriceCents : item?.damagePriceCents;
  return v ?? replacementCents;
}

/** Próximo fim de vigência numa renovação automática. */
export function renewedEnd(endsOn: string, months: number): string {
  const [y, m, d] = endsOn.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

export function formatContractNumber(n: number | string): string {
  return `CT-${String(n).padStart(5, '0')}`;
}
