import { Badge } from '@/components/ui/badge';

export const STATUS_LABEL = {
  pending: { label: 'Aguardando aprovação', variant: 'warning' },
  active: { label: 'Ativo', variant: 'success' },
  suspended: { label: 'Suspenso', variant: 'destructive' },
  inactive: { label: 'Inativo', variant: 'secondary' },
} as const;

export const GEOCODE_LABEL: Record<string, { label: string; variant: 'success' | 'warning' | 'secondary' | 'destructive' | 'default' }> = {
  OK: { label: 'Localizado', variant: 'success' },
  PARTIAL: { label: 'Localização aproximada', variant: 'warning' },
  MANUAL: { label: 'Ajustado no mapa', variant: 'default' },
  PENDING: { label: 'Localização pendente', variant: 'secondary' },
  NOT_FOUND: { label: 'Endereço não encontrado', variant: 'destructive' },
  FAILED: { label: 'Falha na localização', variant: 'destructive' },
  SKIPPED: { label: 'Sem endereço', variant: 'secondary' },
};

export const CHANNEL_LABEL = { WHATSAPP: 'WhatsApp', EMAIL: 'E-mail', PHONE: 'Telefone', NONE: 'Não contatar' } as const;

/** Status sempre com texto (não depende só de cor). */
export function CustomerStatusBadge({ status }: { status: keyof typeof STATUS_LABEL }) {
  const s = STATUS_LABEL[status] ?? { label: status, variant: 'secondary' as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

export function GeocodeBadge({ status }: { status: string }) {
  const s = GEOCODE_LABEL[status] ?? { label: status, variant: 'secondary' as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}
