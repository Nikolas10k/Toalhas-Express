import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  dateStyle: 'short',
  timeStyle: 'medium',
});

/** Datas ficam em UTC no banco e são exibidas em America/Sao_Paulo. */
export function formatDateTime(value: string | Date): string {
  return dateTimeFormatter.format(typeof value === 'string' ? new Date(value) : value);
}
