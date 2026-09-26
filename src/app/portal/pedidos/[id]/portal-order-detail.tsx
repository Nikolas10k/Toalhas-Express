'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { ORDER_TYPE_LABEL, OrderStatusBadge, formatScheduleDate, formatWindow } from '@/components/orders/labels';
import { OrderHistory } from '@/components/orders/order-history';
import { formatAddress, type OrderDetail } from '@/components/orders/types';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch, describeApiError } from '@/lib/api-client';

export function PortalOrderDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const q = useQuery({
    queryKey: ['portal-order', id],
    queryFn: ({ signal }) => apiFetch<OrderDetail>(`/api/portal/orders/${id}`, { signal }),
  });
  const cancel = useMutation({
    mutationFn: () => apiFetch(`/api/portal/orders/${id}/cancel`, { body: { reason } }),
    onSuccess: () => {
      toast.success('Pedido cancelado.');
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['portal-order', id] });
    },
  });

  if (q.isPending) return <Skeleton className="h-64 w-full" />;
  if (q.error) return <Alert variant="destructive">{describeApiError(q.error)}</Alert>;
  const { order: o, items, history, actions } = q.data;

  return (
    <div className="space-y-4">
      <Link href="/portal/pedidos" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Meus pedidos
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Pedido {o.number}</h1>
        <OrderStatusBadge status={o.status} />
      </div>
      <Card>
        <CardContent className="space-y-1 pt-6 text-sm">
          <p>
            <strong>{ORDER_TYPE_LABEL[o.type]}</strong> em {formatScheduleDate(o.scheduledDate)} · {formatWindow(o.windowStart, o.windowEnd)}
          </p>
          <p className="text-muted-foreground">{formatAddress(o.address)}</p>
          {o.notes && <p>Observações: {o.notes}</p>}
          {o.statusReason && <p>Motivo: {o.statusReason}</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Toalhas</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm">
            {items.map((i) => (
              <li key={i.productId} className="flex justify-between gap-2">
                <span>{i.name}</span>
                <span className="tabular-nums text-muted-foreground">
                  {i.deliveryQuantity > 0 && `entregar ${i.deliveryQuantity}`}
                  {i.deliveryQuantity > 0 && i.collectionQuantity > 0 && ' · '}
                  {i.collectionQuantity > 0 && `coletar ${i.collectionQuantity}`}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Acompanhamento</CardTitle>
        </CardHeader>
        <CardContent>
          <OrderHistory history={history} />
        </CardContent>
      </Card>
      {actions.includes('CANCELLED') && (
        <Button variant="outline" className="w-full" onClick={() => setOpen(true)}>
          Cancelar pedido
        </Button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title="Cancelar pedido" description="Pedidos ainda não confirmados podem ser cancelados por aqui.">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            cancel.mutate();
          }}
        >
          <Field id="c-reason" label="Motivo" required>
            <Textarea id="c-reason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {cancel.error && <Alert variant="destructive">{describeApiError(cancel.error)}</Alert>}
          <Button type="submit" variant="destructive" className="w-full" disabled={reason.trim().length < 3 || cancel.isPending}>
            Confirmar cancelamento
          </Button>
        </form>
      </Dialog>
    </div>
  );
}
