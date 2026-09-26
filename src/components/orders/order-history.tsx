import { ORDER_STATUS_LABEL, formatScheduleDate } from '@/components/orders/labels';
import type { OrderDetail } from '@/components/orders/types';
import { formatDateTime } from '@/lib/utils';

const ACTOR_LABEL: Record<string, string> = { SYSTEM: 'Sistema', INTEGRATION: 'Integração (n8n)', USER: 'Usuário' };

export function OrderHistory({ history }: { history: OrderDetail['history'] }) {
  return (
    <ol className="space-y-3 border-l pl-4">
      {history.map((h) => (
        <li key={h.id} className="relative">
          <span className="absolute -left-[1.3rem] top-1.5 size-2.5 rounded-full bg-primary" aria-hidden />
          <p className="text-sm font-medium">
            {h.from ? `${ORDER_STATUS_LABEL[h.from] ?? h.from} → ` : 'Criado como '}
            {ORDER_STATUS_LABEL[h.to] ?? h.to}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatDateTime(h.at)} · {h.actorName ?? ACTOR_LABEL[h.actorType] ?? h.actorType}
          </p>
          {h.reason && <p className="text-sm">{h.reason}</p>}
          {typeof h.metadata.scheduled_date === 'string' && (
            <p className="text-xs text-muted-foreground">Nova data: {formatScheduleDate(h.metadata.scheduled_date)}</p>
          )}
          {h.metadata.stock_override === true && <p className="text-xs text-destructive">Confirmado sem estoque suficiente</p>}
        </li>
      ))}
    </ol>
  );
}
