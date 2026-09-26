'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Repeat } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  ACTION_LABEL,
  ORDER_SOURCE_LABEL,
  ORDER_TYPE_LABEL,
  OrderStatusBadge,
  formatScheduleDate,
  formatWindow,
  todayLocal,
} from '@/components/orders/labels';
import { OrderHistory } from '@/components/orders/order-history';
import { formatAddress, type OrderDetail } from '@/components/orders/types';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch, ApiError, describeApiError } from '@/lib/api-client';

interface TransitionBody {
  to: string;
  reason?: string;
  scheduledDate?: string;
  windowStart?: string | null;
  windowEnd?: string | null;
  overrideStock?: boolean;
}

/** Ações que pedem dados (motivo, nova data) abrem diálogo; as demais são diretas. */
const NEEDS_DIALOG = new Set(['CANCELLED', 'RESCHEDULED']);

export function OrderDetailView({ id }: { id: string }) {
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<'CANCELLED' | 'RESCHEDULED' | 'OVERRIDE' | null>(null);
  const [reason, setReason] = useState('');
  const [newDate, setNewDate] = useState('');
  const [ws, setWs] = useState('');
  const [we, setWe] = useState('');
  const q = useQuery({
    queryKey: ['order', id],
    queryFn: ({ signal }) => apiFetch<OrderDetail>(`/api/admin/orders/${id}`, { signal }),
  });
  const transition = useMutation({
    mutationFn: (body: TransitionBody) => apiFetch(`/api/admin/orders/${id}/transition`, { body }),
    onSuccess: (_r, body) => {
      toast.success(body.overrideStock ? 'Pedido confirmado sem estoque — alerta registrado.' : 'Status atualizado.');
      setDialog(null);
      setReason('');
      qc.invalidateQueries({ queryKey: ['order', id] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: (err, body) => {
      // Estoque insuficiente: oferece o override a quem tem permissão, com motivo.
      if (err instanceof ApiError && err.code === 'INVENTORY_ERROR' && body.to === 'CONFIRMED' && !body.overrideStock && q.data?.canOverrideStock) {
        transition.reset();
        setReason('');
        setDialog('OVERRIDE');
      }
    },
  });

  if (q.isPending) return <Skeleton className="h-96 w-full" />;
  if (q.error) return <Alert variant="destructive">{describeApiError(q.error)}</Alert>;
  const { order: o, items, history, actions } = q.data;
  const insufficient = transition.error instanceof ApiError && transition.error.code === 'INVENTORY_ERROR';

  const openDialog = (to: 'CANCELLED' | 'RESCHEDULED') => {
    transition.reset();
    setReason('');
    setNewDate(o.scheduledDate < todayLocal() ? todayLocal() : o.scheduledDate);
    setWs(o.windowStart ?? '');
    setWe(o.windowEnd ?? '');
    setDialog(to);
  };

  return (
    <>
      <Link href="/admin/pedidos" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Pedidos
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Pedido {o.number}</h1>
            <OrderStatusBadge status={o.status} />
            {o.stockOverride && (
              <Badge variant="warning">
                <AlertTriangle className="size-3" aria-hidden /> Confirmado sem estoque
              </Badge>
            )}
            {o.recurring && (
              <Badge variant="secondary">
                <Repeat className="size-3" aria-hidden /> Recorrente
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            <Link href={`/admin/clientes/${o.customerId}`} className="font-medium text-foreground hover:underline">
              {o.customerName ?? 'Cliente'}
            </Link>{' '}
            · {ORDER_TYPE_LABEL[o.type]} · {formatScheduleDate(o.scheduledDate)} ({formatWindow(o.windowStart, o.windowEnd)}) · origem:{' '}
            {ORDER_SOURCE_LABEL[o.source] ?? o.source}
          </p>
          {o.statusReason && <p className="mt-1 text-sm">Motivo: {o.statusReason}</p>}
        </div>
        {actions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {actions.map((to) => (
              <Button
                key={to}
                variant={to === 'CANCELLED' ? 'outline' : to === 'RESCHEDULED' ? 'outline' : 'default'}
                disabled={transition.isPending}
                onClick={() => (NEEDS_DIALOG.has(to) ? openDialog(to as 'CANCELLED' | 'RESCHEDULED') : transition.mutate({ to }))}
              >
                {ACTION_LABEL[to] ?? to}
              </Button>
            ))}
          </div>
        )}
      </div>

      {transition.error && !dialog && (
        <Alert variant="destructive" className="mb-4">
          {describeApiError(transition.error)}
          {insufficient && !q.data.canOverrideStock && ' Peça a um administrador para confirmar com override ou dê entrada no estoque.'}
        </Alert>
      )}
      {o.status === 'DRAFT' && (
        <Alert className="mb-4">Rascunho criado por automação. Confira itens e data antes de aprovar.</Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Itens</CardTitle>
            </CardHeader>
            <Table>
              <THead>
                <TR>
                  <TH>Produto</TH>
                  <TH className="text-right">Entregar</TH>
                  <TH className="text-right">Coletar</TH>
                  <TH className="text-right">Reservado</TH>
                </TR>
              </THead>
              <TBody>
                {items.map((i) => (
                  <TR key={i.productId}>
                    <TD>
                      {i.name} <span className="text-xs text-muted-foreground">{i.sku}</span>
                    </TD>
                    <TD className="text-right tabular-nums">{i.deliveryQuantity}</TD>
                    <TD className="text-right tabular-nums">{i.collectionQuantity}</TD>
                    <TD className="text-right tabular-nums">{i.reservedQuantity}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Entrega</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>{formatAddress(o.address)}</p>
              {o.assignedName && <p>Responsável: {o.assignedName}</p>}
              {o.notes && (
                <p>
                  <span className="text-muted-foreground">Observações: </span>
                  {o.notes}
                </p>
              )}
              {o.internalNotes && (
                <p>
                  <span className="text-muted-foreground">Notas internas: </span>
                  {o.internalNotes}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Histórico</CardTitle>
          </CardHeader>
          <CardContent>
            <OrderHistory history={history} />
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog === 'OVERRIDE' ? 'Estoque insuficiente' : dialog === 'RESCHEDULED' ? 'Reagendar pedido' : 'Cancelar pedido'}
        description={
          dialog === 'OVERRIDE'
            ? 'Não há toalhas disponíveis para reservar. Você pode confirmar mesmo assim: o saldo disponível ficará negativo, um alerta será aberto e a ação ficará registrada na auditoria.'
            : dialog === 'RESCHEDULED'
              ? 'A reserva de estoque é liberada. Depois, confirme o pedido de novo para reservar na nova data.'
              : 'A reserva de estoque, se houver, é liberada. O pedido não pode ser reaberto.'
        }
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (dialog === 'OVERRIDE') transition.mutate({ to: 'CONFIRMED', overrideStock: true, reason });
            else if (dialog === 'RESCHEDULED') transition.mutate({ to: 'RESCHEDULED', reason, scheduledDate: newDate, windowStart: ws || null, windowEnd: we || null });
            else if (dialog === 'CANCELLED') transition.mutate({ to: 'CANCELLED', reason });
          }}
        >
          {dialog === 'RESCHEDULED' && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field id="rs-date" label="Nova data" required>
                <Input id="rs-date" type="date" min={todayLocal()} value={newDate} onChange={(e) => setNewDate(e.target.value)} />
              </Field>
              <Field id="rs-ws" label="Início">
                <Input id="rs-ws" type="time" value={ws} onChange={(e) => setWs(e.target.value)} />
              </Field>
              <Field id="rs-we" label="Fim">
                <Input id="rs-we" type="time" value={we} onChange={(e) => setWe(e.target.value)} />
              </Field>
            </div>
          )}
          <Field id="tr-reason" label="Motivo" required hint={dialog === 'OVERRIDE' ? 'Mínimo de 5 caracteres. Fica na auditoria.' : undefined}>
            <Textarea id="tr-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {transition.error && <Alert variant="destructive">{describeApiError(transition.error)}</Alert>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setDialog(null)}>
              Voltar
            </Button>
            <Button
              type="submit"
              variant={dialog === 'CANCELLED' ? 'destructive' : 'default'}
              disabled={transition.isPending || reason.trim().length < (dialog === 'OVERRIDE' ? 5 : 3) || (dialog === 'RESCHEDULED' && !newDate)}
            >
              {dialog === 'OVERRIDE' ? 'Confirmar sem estoque' : dialog === 'RESCHEDULED' ? 'Reagendar' : 'Cancelar pedido'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
