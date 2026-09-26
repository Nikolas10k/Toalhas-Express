/**
 * CPF/CNPJ: normalização (só dígitos/letras maiúsculas) e validação dos
 * dígitos verificadores. Suporta o CNPJ alfanumérico (IN RFB 2.229/2024,
 * vigente desde jul/2026): 12 caracteres [0-9A-Z] + 2 dígitos verificadores,
 * com valor de cada caractere = código ASCII − 48.
 */
export type DocumentType = 'CPF' | 'CNPJ';

export function normalizeDocument(value: string): string {
  return value.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

function allSame(s: string): boolean {
  return s.split('').every((c) => c === s[0]);
}

export function isValidCpf(value: string): boolean {
  const cpf = normalizeDocument(value);
  if (!/^\d{11}$/.test(cpf) || allSame(cpf)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}

export function isValidCnpj(value: string): boolean {
  const cnpj = normalizeDocument(value);
  if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj) || allSame(cnpj)) return false;
  const val = (c: string) => c.charCodeAt(0) - 48;
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < len; i++) sum += val(cnpj[i]!) * weights[i]!;
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return calc(12) === Number(cnpj[12]) && calc(13) === Number(cnpj[13]);
}

export function detectDocumentType(value: string): DocumentType | null {
  const doc = normalizeDocument(value);
  if (doc.length === 11 && isValidCpf(doc)) return 'CPF';
  if (doc.length === 14 && isValidCnpj(doc)) return 'CNPJ';
  return null;
}

/** Máscara apenas para exibição. */
export function formatDocument(value: string | null | undefined): string {
  if (!value) return '';
  const d = normalizeDocument(value);
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return d;
}
