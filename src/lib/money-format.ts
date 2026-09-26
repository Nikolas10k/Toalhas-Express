const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Exibição de centavos inteiros em R$. */
export function formatCents(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : brl.format(value / 100);
}

/** "1.234,56" / "15" / "15,5" → centavos inteiros (sem float na conta). */
export function parseBRLToCents(input: string): number | null {
  const s = input.replace(/[R$\s.]/g, '').trim();
  if (!/^\d{1,9}(,\d{0,2})?$/.test(s)) return null;
  const [int, frac = ''] = s.split(',');
  return Number(int) * 100 + Number(frac.padEnd(2, '0'));
}

export function centsToInput(value: number): string {
  return (value / 100).toFixed(2).replace('.', ',');
}
