'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { AlertTriangle, MapPin } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/admin/page-header';
import { todayLocal } from '@/components/orders/labels';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { apiFetch, describeApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/utils';
import { AttachmentLinks } from './attachment-link';

export interface OperationItem {
  id: string;
  routeId: string;
  orderId: string;
  orderNumber: string;
  customerId: string;
  customerName: string | null;
  driverName: string | null;
  recipientName: string | null;
  notes: string | null;
  geolocation: { lat: number | null; lng: number | null } | null;
  occurredAt: string;
  delivered: number;
  planned: number;
  collected: number;
  expected: number;
  damaged: number;
  incidents: number;
  attachmentIds: string[];
}

export function OperationsTable({ items, kind, showCustomer = true }: { items: OperationItem[]; kind?: 'delivery' | 'collection'; showCustomer?: boolean }) {
  return (
    <Table>
      <THead>
        <TR>
          <TH>Quando</TH>
          {showCustomer && <TH>Cliente</TH>}
          <TH>Pedido</TH>
          {kind !== 'collection' && <TH className="text-right">Entregue / previsto</TH>}
          {kind !== 'delivery' && <TH className="text-right">Coletado / esperado</TH>}
          <TH>Prova</TH>
        </TR>
      </THead>
      <TBody>
        {items.map((o) => (
          <TR key={o.id}>
            <TD className="whitespace-nowrap text-sm">
              {formatDateTime(o.occurredAt)}
              <span className="block text-xs text-muted-foreground">{o.driverName ?? '—'}</span>
            </TD>
            {showCustomer && (
              <TD>
                <Link href={`/admin/clientes/${o.customerId}`} className="hover:underline">
                  {o.customerName ?? 'Cliente'}
                </Link>
              </TD>
            )}
            <TD className="whitespace-nowrap">
              <Link href={`/admin/pedidos/${o.orderId}`} className="hover:underline">
                {o.orderNumber}
              </Link>
              {o.incidents > 0 && (
                <Badge variant="warning" className="ml-1">
                  <AlertTriangle className="size-3" aria-hidden /> {o.incidents}
                </Badge>
              )}
            </TD>
            {kind !== 'collection' && (
              <TD className={`text-right tabular-nums ${o.delivered < o.planned ? 'text-destructive' : ''}`}>
                {o.delivered} / {o.planned}
              </TD>
            )}
            {kind !== 'delivery' && (
              <TD className={`text-right tabular-nums ${o.collected !== o.expected ? 'text-destructive' : ''}`}>
                {o.collected} / {o.expected}
                {o.damaged > 0 && <span className="block text-xs">{o.damaged} com dano</span>}
              </TD>
            )}
            <TD className="text-sm">
              <span className="block">Recebido por: {o.recipientName ?? '—'}</span>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="size-3" aria-hidden />
                {o.geolocation ? (
                  <a href={`https://www.google.com/maps?q=${o.geolocation.lat},${o.geolocation.lng}`} target="_blank" rel="noopener noreferrer" className="underline">
                    local registrado
                  </a>
                ) : (
                  'sem geolocalização'
                )}
              </span>
              <AttachmentLinks ids={o.attachmentIds} />
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

export function OperationsList({ kind }: { kind: 'delivery' | 'collection' }) {
  const [date, setDate] = useState(todayLocal());
  const q = useInfiniteQuery({
    queryKey: ['operations', kind, date],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => {
      const p = new URLSearchParams({ kind, page: String(pageParam) });
      if (date) p.set('date', date);
      return apiFetch<{ items: OperationItem[]; hasMore: boolean }>(`/api/admin/operations?${p}`, { signal });
    },
    getNextPageParam: (last, all) => (last.hasMore ? all.length + 1 : undefined),
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <PageHeader
        title={kind === 'delivery' ? 'Entregas' : 'Coletas'}
        description="Registros feitos pelo motorista na parada, com recebedor, horário, local e fotos. Diferenças viram ocorrência automaticamente."
      />
      <div className="mb-4">
        <label className="flex items-center gap-2 text-sm">
          Data
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
        </label>
      </div>
      {q.error && <Alert variant="destructive">{describeApiError(q.error)}</Alert>}
      <Card>
        {q.isPending ? (
          <div className="p-4">
            <Skeleton className="h-6 w-full" />
          </div>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-muted-foreground">Nenhum registro nesta data.</p>
        ) : (
          <OperationsTable items={items} kind={kind} />
        )}
      </Card>
      {q.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
            Carregar mais
          </Button>
        </div>
      )}
    </>
  );
}
