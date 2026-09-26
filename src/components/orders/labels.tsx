import { Badge } from '@/components/ui/badge';

export const ORDER_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Rascunho',
  NEW: 'Novo',
  CONFIRMED: 'Confirmado',
  PREPARING: 'Em separação',
  READY: 'Pronto',
  ROUTE_ASSIGNED: 'Em rota planejada',
  IN_TRANSIT: 'Em trânsito',
  DELIVERED: 'Entregue',
  DELIVERY_PROBLEM: 'Problema na entrega',
  RESCHEDULED: 'Reagendado',
  CANCELLED: 'Cancelado',
  COMPLETED: 'Concluído',
};

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline'> = {
  DRAFT: 'outline',
  NEW: 'warning',
  CONFIRMED: 'default',
  PREPARING: 'default',
  READY: 'default',
  ROUTE_ASSIGNED: 'default',
  IN_TRANSIT: 'default',
  DELIVERED: 'success',
  DELIVERY_PROBLEM: 'destructive',
  RESCHEDULED: 'warning',
  CANCELLED: 'secondary',
  COMPLETED: 'success',
};

export function OrderStatusBadge({ status }: { status: string }) {
  return <Badge variant={STATUS_VARIANT[status] ?? 'secondary'}>{ORDER_STATUS_LABEL[status] ?? status}</Badge>;
}

export const ORDER_TYPE_LABEL: Record<string, string> = {
  DELIVERY: 'Entrega',
  COLLECTION: 'Coleta',
  DELIVERY_AND_COLLECTION: 'Entrega e coleta',
};

export const ORDER_SOURCE_LABEL: Record<string, string> = {
  ADMIN: 'Equipe',
  PORTAL: 'Portal do cliente',
  INTEGRATION: 'WhatsApp/n8n',
  RECURRENCE: 'Recorrência',
};

/** Rótulo do botão de ação para cada status de destino. */
export const ACTION_LABEL: Record<string, string> = {
  NEW: 'Aprovar rascunho',
  CONFIRMED: 'Confirmar',
  PREPARING: 'Iniciar separação',
  READY: 'Marcar como pronto',
  RESCHEDULED: 'Reagendar',
  CANCELLED: 'Cancelar pedido',
};

export const WEEKDAY_SHORT = ['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

/** Datas de agenda (DATE, sem fuso): YYYY-MM-DD → DD/MM/YYYY. */
export function formatScheduleDate(date: string | null | undefined): string {
  if (!date) return '—';
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}

export function formatWindow(start: string | null, end: string | null): string {
  if (!start && !end) return 'Horário comercial';
  if (start && end) return `${start}–${end}`;
  return start ? `a partir de ${start}` : `até ${end}`;
}

/** YYYY-MM-DD de hoje em America/Sao_Paulo (o servidor revalida). */
export function todayLocal(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function addDaysLocal(days: number): string {
  const d = new Date(`${todayLocal()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
