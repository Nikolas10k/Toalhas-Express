import { Badge } from '@/components/ui/badge';

export const ROUTE_STATUS_LABEL: Record<string, string> = {
  PLANNED: 'Planejada',
  IN_PROGRESS: 'Em andamento',
  COMPLETED: 'Concluída',
  CANCELLED: 'Cancelada',
};
const ROUTE_VARIANT: Record<string, 'default' | 'secondary' | 'success' | 'warning'> = {
  PLANNED: 'warning',
  IN_PROGRESS: 'default',
  COMPLETED: 'success',
  CANCELLED: 'secondary',
};
export function RouteStatusBadge({ status }: { status: string }) {
  return <Badge variant={ROUTE_VARIANT[status] ?? 'secondary'}>{ROUTE_STATUS_LABEL[status] ?? status}</Badge>;
}

export const STOP_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pendente',
  ON_THE_WAY: 'A caminho',
  ARRIVED: 'No local',
  IN_SERVICE: 'Em atendimento',
  COMPLETED: 'Concluída',
  FAILED: 'Com problema',
  SKIPPED: 'Não visitada',
  RESCHEDULED: 'Reagendada',
};
const STOP_VARIANT: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline'> = {
  PENDING: 'outline',
  ON_THE_WAY: 'default',
  ARRIVED: 'warning',
  IN_SERVICE: 'warning',
  COMPLETED: 'success',
  FAILED: 'destructive',
  SKIPPED: 'secondary',
  RESCHEDULED: 'secondary',
};
export function StopStatusBadge({ status }: { status: string }) {
  return <Badge variant={STOP_VARIANT[status] ?? 'secondary'}>{STOP_STATUS_LABEL[status] ?? status}</Badge>;
}

export const DRIVER_STATUS_LABEL: Record<string, string> = { ACTIVE: 'Ativo', INACTIVE: 'Inativo', ON_LEAVE: 'Afastado' };
export const VEHICLE_STATUS_LABEL: Record<string, string> = { ACTIVE: 'Ativo', INACTIVE: 'Inativo', MAINTENANCE: 'Em manutenção' };

export function formatDistance(meters: number | null | undefined): string {
  if (meters === null || meters === undefined) return '—';
  return meters < 1000 ? `${meters} m` : `${(meters / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}
