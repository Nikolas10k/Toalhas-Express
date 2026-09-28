import { Badge } from '@/components/ui/badge';

export const INCIDENT_TYPE_LABEL: Record<string, string> = {
  NOT_RETURNED: 'Não devolvida',
  IN_USE: 'Em uso pelo cliente',
  DAMAGED: 'Dano',
  LOST: 'Perda',
  CUSTOMER_REFUSED: 'Cliente recusou',
  CUSTOMER_CLOSED: 'Estabelecimento fechado',
  ADDRESS_PROBLEM: 'Problema no endereço',
  QUANTITY_DIVERGENCE: 'Divergência de quantidade',
  OTHER: 'Outro',
};

export const INCIDENT_STATUS_LABEL: Record<string, string> = {
  OPEN: 'Aberta',
  UNDER_REVIEW: 'Em análise',
  RESOLVED: 'Resolvida',
  CANCELLED: 'Cancelada',
};

const STATUS_VARIANT: Record<string, 'warning' | 'default' | 'success' | 'secondary'> = {
  OPEN: 'warning',
  UNDER_REVIEW: 'default',
  RESOLVED: 'success',
  CANCELLED: 'secondary',
};

export function IncidentStatusBadge({ status }: { status: string }) {
  return <Badge variant={STATUS_VARIANT[status] ?? 'secondary'}>{INCIDENT_STATUS_LABEL[status] ?? status}</Badge>;
}

export const DAMAGE_CLASS_LABEL: Record<string, string> = {
  TORN: 'Rasgada',
  STAINED: 'Manchada',
  BURNED: 'Queimada',
  FRAYED: 'Desfiada',
  WORN: 'Desgaste',
};

export const DECISION_LABEL: Record<string, string> = {
  NO_ACTION: 'Sem movimentação (ex.: cliente ainda está usando)',
  RETURN_TO_LAUNDRY: 'Voltar para a lavagem',
  RETURN_TO_STOCK: 'Voltar ao estoque disponível',
  DISCARD: 'Descartar sem cobrar',
  CHARGE_CUSTOMER: 'Descartar e cobrar o cliente',
  REGISTER_LOSS: 'Registrar como perda',
};

export const PROBLEM_TYPES: [string, string][] = [
  ['CUSTOMER_CLOSED', 'Estabelecimento fechado'],
  ['CUSTOMER_REFUSED', 'Cliente recusou'],
  ['ADDRESS_PROBLEM', 'Problema no endereço'],
  ['OTHER', 'Outro problema'],
];
