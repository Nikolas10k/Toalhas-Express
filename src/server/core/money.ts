/**
 * Dinheiro SEMPRE em centavos inteiros (BIGINT no banco). Nunca usar float
 * para valores monetários. Valores acima de Number.MAX_SAFE_INTEGER são
 * rejeitados (R$ 90 trilhões — fora de qualquer caso real).
 */
export type Cents = number & { readonly __brand: 'Cents' };

export function cents(value: number | bigint | string): Cents {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(n)) throw new RangeError(`Valor monetário inválido (centavos): ${String(value)}`);
  return n as Cents;
}

export function addCents(...values: Cents[]): Cents {
  return cents(values.reduce<number>((acc, v) => acc + v, 0));
}

/** Multiplicação por quantidade inteira (ex.: 30 toalhas × preço de reposição). */
export function multiplyCents(value: Cents, quantity: number): Cents {
  if (!Number.isSafeInteger(quantity)) throw new RangeError('Quantidade deve ser inteira.');
  return cents(value * quantity);
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Formatação apenas para exibição. */
export function formatBRL(value: Cents): string {
  return brl.format(value / 100);
}
