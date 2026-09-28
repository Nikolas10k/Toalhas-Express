import { Badge } from '@/components/ui/badge';

export const LAUNDRY_STATUS_LABEL: Record<string, string> = {
  WAITING: 'Aguardando',
  WASHING: 'Lavando',
  DRYING: 'Secando',
  FOLDING: 'Dobrando',
  INSPECTION: 'Em inspeção',
  COMPLETED: 'Concluído',
  CANCELLED: 'Cancelado',
};

export const LAUNDRY_STEPS = ['WAITING', 'WASHING', 'DRYING', 'FOLDING', 'INSPECTION', 'COMPLETED'] as const;

export const NEXT_ACTION_LABEL: Record<string, string> = {
  WASHING: 'Iniciar lavagem',
  DRYING: 'Ir para secagem',
  FOLDING: 'Ir para dobra',
  INSPECTION: 'Ir para inspeção',
};

export function LaundryStatusBadge({ status }: { status: string }) {
  const variant = status === 'COMPLETED' ? 'success' : status === 'CANCELLED' ? 'secondary' : status === 'WAITING' ? 'warning' : 'default';
  return <Badge variant={variant}>{LAUNDRY_STATUS_LABEL[status] ?? status}</Badge>;
}
