import { describe, expect, it } from 'vitest';
import { addCents, cents, formatBRL, multiplyCents } from '@/server/core/money';

describe('money (centavos)', () => {
  it('aceita somente inteiros seguros', () => {
    expect(cents('45000')).toBe(45000);
    expect(() => cents(10.5)).toThrow(RangeError);
    expect(() => cents(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });

  it('30 toalhas perdidas × R$ 15,00 = R$ 450,00', () => {
    const total = multiplyCents(cents(1500), 30);
    expect(total).toBe(45000);
    expect(formatBRL(total).replace(/\s/g, ' ')).toBe('R$ 450,00');
  });

  it('soma sem ponto flutuante', () => {
    expect(addCents(cents(10), cents(20))).toBe(30);
    expect(() => multiplyCents(cents(100), 1.5)).toThrow(RangeError);
  });
});
