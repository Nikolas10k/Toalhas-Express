export const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
  'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;
export type Uf = (typeof UFS)[number];

export function normalizeCep(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = value.replace(/\D/g, '');
  return d.length === 8 ? d : null;
}

export function formatCep(value: string | null | undefined): string {
  if (!value) return '';
  return value.length === 8 ? `${value.slice(0, 5)}-${value.slice(5)}` : value;
}

export interface AddressParts {
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  district?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
}

/** Linha única para geocoding e exibição. */
export function formatAddress(a: AddressParts): string {
  const line1 = [a.street, a.number].filter(Boolean).join(', ');
  const parts = [
    [line1, a.complement].filter(Boolean).join(' - '),
    a.district,
    [a.city, a.state].filter(Boolean).join(' - '),
    a.postalCode ? formatCep(a.postalCode) : null,
  ].filter((p) => p && String(p).trim() !== '');
  return parts.join(', ');
}
