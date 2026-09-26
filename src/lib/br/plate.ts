/** Placa brasileira: antiga (AAA9999) ou Mercosul (AAA9A99). Armazenada sem hífen, maiúscula. */
const PLATE = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;

export function normalizePlate(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return PLATE.test(v) ? v : null;
}

export function formatPlate(value: string | null | undefined): string {
  if (!value) return '';
  // Antiga ganha hífen (ABC-1234); Mercosul fica corrida (ABC1D23).
  return /^[A-Z]{3}[0-9]{4}$/.test(value) ? `${value.slice(0, 3)}-${value.slice(3)}` : value;
}
