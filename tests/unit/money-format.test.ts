import { describe, expect, it } from 'vitest';
import { centsToInput, formatCents, parseBRLToCents } from '@/lib/money-format';

describe('entrada de valores em R$', () => {
  it.each([
    ['15', 1500],
    ['15,5', 1550],
    ['1.234,56', 123456],
    ['R$ 0,99', 99],
    ['abc', null],
    ['1,234', null],
    ['-5', null],
  ])('%s → %s', (i, o) => expect(parseBRLToCents(i)).toBe(o));

  it('formata', () => {
    expect(formatCents(45000).replace(/\s/g, ' ')).toBe('R$ 450,00');
    expect(centsToInput(1550)).toBe('15,50');
  });
});
