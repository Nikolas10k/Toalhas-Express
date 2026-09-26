/** Gera CPF/CNPJ válidos (dígitos verificadores corretos) para testes. */
function cpfDigit(base: string): number {
  let sum = 0;
  for (let i = 0; i < base.length; i++) sum += Number(base[i]) * (base.length + 1 - i);
  const rest = (sum * 10) % 11;
  return rest === 10 ? 0 : rest;
}

export function makeCpf(seed: number): string {
  const base = String(100000000 + (seed % 899999999)).padStart(9, '0').slice(0, 9);
  const d1 = cpfDigit(base);
  const d2 = cpfDigit(base + d1);
  return `${base}${d1}${d2}`;
}

function cnpjDigit(base: string): number {
  const weights = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < base.length; i++) sum += (base.charCodeAt(i) - 48) * weights[i]!;
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export function makeCnpj(seed: number, alnum = false): string {
  const root = alnum ? `A${String(seed % 10000000).padStart(7, '0')}` : String(10000000 + (seed % 89999999)).slice(0, 8);
  const base = `${root}0001`;
  const d1 = cnpjDigit(base);
  const d2 = cnpjDigit(base + d1);
  return `${base}${d1}${d2}`;
}

let counter = Math.floor(Math.random() * 1_000_000);
export const nextCpf = () => makeCpf(++counter * 7919);
export const nextCnpj = () => makeCnpj(++counter * 104729);
