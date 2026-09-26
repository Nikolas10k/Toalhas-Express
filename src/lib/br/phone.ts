/**
 * Telefones brasileiros normalizados em E.164 (+55 + DDD + número).
 * Aceita entradas com máscara, com/sem +55, com 0 de operadora.
 */
const VALID_DDD = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91,
  92, 93, 94, 95, 96, 97, 98, 99,
]);

export function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null;
  let d = value.replace(/\D/g, '');
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.startsWith('0')) d = d.replace(/^0+/, '');
  // 0 + operadora (2 dígitos) + DDD + número: 0 XX DD NNNNNNNNN
  if (d.length === 12 || d.length === 13) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  const ddd = Number(d.slice(0, 2));
  if (!VALID_DDD.has(ddd)) return null;
  const local = d.slice(2);
  if (local.length === 9 && local[0] !== '9') return null; // celular sempre começa com 9
  if (local.length === 8 && !/[2-5]/.test(local[0]!)) return null; // fixo começa com 2-5
  return `+55${d}`;
}

export function isMobile(e164: string): boolean {
  return /^\+55\d{2}9\d{8}$/.test(e164);
}

export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const d = e164.replace(/^\+55/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return e164;
}
