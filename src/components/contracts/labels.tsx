import { Badge } from '@/components/ui/badge';

export const CONTRACT_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Rascunho',
  ACTIVE: 'Vigente',
  SUSPENDED: 'Suspenso',
  ENDED: 'Encerrado',
  CANCELLED: 'Cancelado',
};

export const BILLING_TYPE_LABEL: Record<string, string> = {
  MONTHLY_FIXED: 'Mensalidade fixa',
  PER_DELIVERY: 'Por entrega',
  PER_QUANTITY: 'Por peça entregue',
  HYBRID: 'Mensalidade + excedente (franquia)',
  CUSTOM: 'Personalizado',
};

export const RENEWAL_LABEL: Record<string, string> = { AUTO: 'Automática', MANUAL: 'Manual', NONE: 'Sem renovação' };

export function ContractStatusBadge({ status }: { status: string }) {
  const v = status === 'ACTIVE' ? 'success' : status === 'DRAFT' ? 'warning' : status === 'SUSPENDED' ? 'destructive' : 'secondary';
  return <Badge variant={v}>{CONTRACT_STATUS_LABEL[status] ?? status}</Badge>;
}
