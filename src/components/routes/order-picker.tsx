'use client';

import { formatWindow } from '@/components/orders/labels';
import { ORDER_TYPE_LABEL } from '@/components/orders/labels';
import { cn } from '@/lib/utils';
import { shortAddress, type PlannableOrder } from './types';

/** Lista de pedidos prontos com seleção; a ordem de seleção vira a ordem das paradas. */
export function OrderPicker({ orders, selected, onToggle }: { orders: PlannableOrder[]; selected: string[]; onToggle: (id: string) => void }) {
  return (
    <ul className="max-h-[28rem] divide-y overflow-y-auto rounded-md border" aria-label="Pedidos prontos para a data">
      {orders.map((o) => {
        const idx = selected.indexOf(o.id);
        return (
          <li key={o.id}>
            <label className={cn('flex cursor-pointer items-start gap-3 p-3 text-sm hover:bg-accent', idx >= 0 && 'bg-primary/5')}>
              <input type="checkbox" className="mt-1 size-4" checked={idx >= 0} onChange={() => onToggle(o.id)} />
              <span className="flex-1">
                <span className="font-medium">
                  {idx >= 0 && <span className="mr-1 rounded bg-primary px-1.5 text-xs text-primary-foreground">{idx + 1}</span>}
                  {o.customerName ?? 'Cliente'} <span className="text-muted-foreground">· {o.number}</span>
                </span>
                <span className="block text-xs text-muted-foreground">
                  {shortAddress(o.address)} · {formatWindow(o.windowStart, o.windowEnd)}
                </span>
                <span className="block text-xs">
                  {ORDER_TYPE_LABEL[o.type]}: entregar {o.totalDelivery}, coletar {o.totalCollection}
                  {(o.latitude === null || o.longitude === null) && <span className="ml-1 text-destructive">· sem localização no mapa</span>}
                </span>
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
