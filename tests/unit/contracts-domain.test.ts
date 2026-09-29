import { describe, expect, it } from 'vitest';
import { BusinessRuleError } from '@/server/core/errors';
import {
  assertTermsConsistent,
  computeMonthBilling,
  CONTRACT_STATUSES,
  contractStateMachine,
  coveredDays,
  dueDateFor,
  lossDamagePrice,
  renewedEnd,
  roundDiv,
  type ContractTerms,
} from '@/server/modules/contracts/contracts.domain';

const item = { productId: 'p1', productName: 'Toalha banho', contractedQuantity: 200, franchiseQuantity: 150, unitPriceCents: 250, excessPriceCents: 300, lossPriceCents: null, damagePriceCents: 2000 };
const base: ContractTerms = {
  billingType: 'MONTHLY_FIXED', startsOn: '2026-01-01', endsOn: null, dueDay: 10, monthlyFeeCents: 50_000, perDeliveryFeeCents: 0, discountBp: 0, prorateFirstMonth: true, items: [item],
};
const usage = (delivered: number, deliveries = 4) => ({ deliveries, deliveredByProduct: { p1: delivered } });

describe('máquina de estados do contrato', () => {
  const table: Record<string, string[]> = { DRAFT: ['ACTIVE', 'CANCELLED'], ACTIVE: ['SUSPENDED', 'ENDED'], SUSPENDED: ['ACTIVE', 'ENDED'], ENDED: [], CANCELLED: [] };
  it('aceita exatamente a tabela', () => {
    for (const f of CONTRACT_STATUSES) for (const t of CONTRACT_STATUSES) expect(contractStateMachine.canTransition(f, t), `${f}→${t}`).toBe(table[f]!.includes(t));
  });
});

describe('cálculo do mês por tipo de cobrança', () => {
  it('MONTHLY_FIXED: contrato de R$ 500 gera R$ 500 no mês cheio (SPEC §14)', () => {
    const b = computeMonthBilling(base, '2026-03', usage(999));
    expect(b.totalCents).toBe(50_000);
    expect(b.lines).toHaveLength(1);
    expect(b.dueDate).toBe('2026-04-10');
  });
  it('mensalidade proporcional no primeiro mês (início dia 16 de um mês de 31 dias)', () => {
    const b = computeMonthBilling({ ...base, startsOn: '2026-03-16' }, '2026-03', usage(0));
    expect(b.coveredDays).toBe(16);
    expect(b.totalCents).toBe(roundDiv(50_000 * 16, 31)); // 25.806,45… → 25.806
    expect(b.totalCents).toBe(25_806);
    expect(computeMonthBilling({ ...base, startsOn: '2026-03-16', prorateFirstMonth: false }, '2026-03', usage(0)).totalCents).toBe(50_000);
  });
  it('fora da vigência não cobra nada', () => {
    expect(computeMonthBilling({ ...base, startsOn: '2026-05-01' }, '2026-04', usage(10)).totalCents).toBe(0);
    expect(computeMonthBilling({ ...base, endsOn: '2026-02-28' }, '2026-03', usage(10)).totalCents).toBe(0);
  });
  it('PER_DELIVERY: entregas × valor', () => {
    const b = computeMonthBilling({ ...base, billingType: 'PER_DELIVERY', monthlyFeeCents: 0, perDeliveryFeeCents: 3_500 }, '2026-03', usage(0, 9));
    expect(b.totalCents).toBe(31_500);
  });
  it('PER_QUANTITY: peças entregues × preço por peça', () => {
    const b = computeMonthBilling({ ...base, billingType: 'PER_QUANTITY', monthlyFeeCents: 0 }, '2026-03', usage(420));
    expect(b.totalCents).toBe(105_000);
  });
  it('HYBRID: mensalidade + excedente acima da franquia (e nada abaixo dela)', () => {
    const t = { ...base, billingType: 'HYBRID' as const };
    const over = computeMonthBilling(t, '2026-03', usage(180));
    expect(over.lines.map((l) => [l.kind, l.quantity, l.amountCents])).toEqual([['MONTHLY_FEE', 1, 50_000], ['EXCESS', 30, 9_000]]);
    expect(over.totalCents).toBe(59_000);
    expect(computeMonthBilling(t, '2026-03', usage(150)).totalCents).toBe(50_000);
  });
  it('desconto em pontos-base com arredondamento meio-para-cima, nunca total negativo', () => {
    const b = computeMonthBilling({ ...base, monthlyFeeCents: 33_333, discountBp: 1_000 }, '2026-03', usage(0));
    expect(b.discountCents).toBe(3_333); // 3.333,3 → 3.333
    expect(b.totalCents).toBe(30_000);
    expect(computeMonthBilling({ ...base, discountBp: 10_000 }, '2026-03', usage(0)).totalCents).toBe(0);
    expect(roundDiv(5, 2)).toBe(3);
    expect(roundDiv(4, 3)).toBe(1);
  });
  it('CUSTOM: marca lançamento manual', () => {
    expect(computeMonthBilling({ ...base, billingType: 'CUSTOM' }, '2026-03', usage(0)).requiresManual).toBe(true);
  });
});

describe('consistência dos termos', () => {
  it('cada tipo exige o que precisa', () => {
    expect(() => assertTermsConsistent({ ...base, monthlyFeeCents: 0 })).toThrow(/mensalidade/);
    expect(() => assertTermsConsistent({ ...base, billingType: 'PER_DELIVERY', perDeliveryFeeCents: 0, items: [] })).toThrow(/por entrega/);
    expect(() => assertTermsConsistent({ ...base, billingType: 'PER_QUANTITY', items: [{ ...item, franchiseQuantity: 0, unitPriceCents: 0 }] })).toThrow(/por peça/);
    expect(() => assertTermsConsistent({ ...base, billingType: 'HYBRID', items: [{ ...item, excessPriceCents: 0 }] })).toThrow(/excedente/);
    expect(() => assertTermsConsistent({ ...base, items: [item, item] })).toThrow(BusinessRuleError);
    expect(() => assertTermsConsistent({ ...base, items: [item] })).toThrow(/Franquia/);
    expect(() => assertTermsConsistent({ ...base, billingType: 'HYBRID', items: [item] })).not.toThrow();
  });
});

describe('datas e preços auxiliares', () => {
  it('dias cobertos, vencimento e renovação respeitam fim de mês', () => {
    expect(coveredDays('2026-02', '2026-02-10', null)).toBe(19);
    expect(dueDateFor('2026-12', 5)).toBe('2027-01-05');
    expect(renewedEnd('2026-01-31', 1)).toBe('2026-02-28');
    expect(renewedEnd('2026-06-30', 12)).toBe('2027-06-30');
  });
  it('perda/dano: preço do contrato ou, sem ele, o de reposição', () => {
    expect(lossDamagePrice(item, 'DAMAGE', 1500)).toBe(2000);
    expect(lossDamagePrice(item, 'LOSS', 1500)).toBe(1500);
    expect(lossDamagePrice(null, 'LOSS', 1500)).toBe(1500);
  });
});

describe('higienização de enxoval do cliente (por peça)', () => {
  const linen = { productId: 'l1', productName: 'Lençol casal', kind: 'LINEN' as const, contractedQuantity: 0, franchiseQuantity: 0, unitPriceCents: 250, excessPriceCents: 0, lossPriceCents: null, damagePriceCents: null };
  it('cobra por peça do rol em qualquer tipo de contrato, somando à mensalidade', () => {
    const b = computeMonthBilling({ ...base, items: [item, linen] }, '2026-03', { ...usage(0), linenByProduct: { l1: 120 } });
    expect(b.lines.map((l) => [l.kind, l.amountCents])).toEqual([['MONTHLY_FEE', 50_000], ['LINEN_SERVICE', 30_000]]);
    expect(b.totalCents).toBe(80_000);
  });
  it('contrato só de enxoval (por peça) é válido; enxoval sem preço ou com franquia é recusado', () => {
    expect(() => assertTermsConsistent({ ...base, billingType: 'PER_QUANTITY', monthlyFeeCents: 0, items: [linen] })).not.toThrow();
    expect(() => assertTermsConsistent({ ...base, billingType: 'PER_QUANTITY', items: [{ ...linen, unitPriceCents: 0 }] })).toThrow(BusinessRuleError);
    expect(() => assertTermsConsistent({ ...base, billingType: 'HYBRID', items: [item, { ...linen, franchiseQuantity: 10 }] })).toThrow(/sem franquia/);
  });
  it('HYBRID ignora o enxoval na franquia e no excedente', () => {
    const b = computeMonthBilling({ ...base, billingType: 'HYBRID', items: [item, linen] }, '2026-03', { deliveries: 4, deliveredByProduct: { p1: 160, l1: 999 }, linenByProduct: { l1: 10 } });
    expect(b.lines.map((l) => [l.kind, l.quantity])).toEqual([['MONTHLY_FEE', 1], ['EXCESS', 10], ['LINEN_SERVICE', 10]]);
  });
});
