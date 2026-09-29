import { Badge } from '@/components/ui/badge';

export const SERVICE_ORDER_STATUS_LABEL: Record<string, string> = {
  COLLECTED: 'Na lavanderia',
  READY: 'Pronta',
  DELIVERED: 'Entregue',
  CANCELLED: 'Cancelada',
};

export function ServiceOrderStatusBadge({ status }: { status: string }) {
  const v = status === 'DELIVERED' ? 'success' : status === 'READY' ? 'default' : status === 'COLLECTED' ? 'warning' : 'secondary';
  return <Badge variant={v}>{SERVICE_ORDER_STATUS_LABEL[status] ?? status}</Badge>;
}

export const PRODUCT_KIND_LABEL: Record<string, string> = { RENTAL: 'Toalha de aluguel', LINEN: 'Enxoval do cliente' };
