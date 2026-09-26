'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { Plus, Repeat } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/admin/page-header';
import { ORDER_STATUS_LABEL, ORDER_TYPE_LABEL, OrderStatusBadge, formatScheduleDate, formatWindow } from '@/components/orders/labels';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { apiFetch, describeApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';

export interface OrderListItem {
  id: string;
  number: string;
  customerId: string;
  customerName: string | null;
  type: string;
  status: string;
  scheduledDate: string;
  windowStart: string | null;
  windowEnd: string | null;
  source: string;
  recurring: boolean;
  stockOverride: boolean;
  totalDelivery: number;
  totalCollection: number;
}

interface ListResponse {
  items: OrderListItem[];
  hasMore: boolean;
  counts?: Record<string, number>;
}

const FILTERS = ['', 'DRAFT', 'NEW', 'CONFIRMED', 'PREPARING', 'READY', 'ROUTE_ASSIGNED', 'IN_TRANSIT', 'DELIVERY_PROBLEM', 'RESCHEDULED', 'DELIVERED', 'COMPLETED', 'CANCELLED'];

export function OrdersTable({ items, showCustomer = true }: { items: OrderListItem[]; showCustomer?: boolean }) {
  const router = useRouter();
  return (
    <Table>
      <THead>
        <TR>
          <TH>Pedido</TH>
          {showCustomer && <TH>Cliente</TH>}
          <TH>Data</TH>
          <TH>Tipo</TH>
          <TH className="text-right">Entregar</TH>
          <TH className="text-right">Coletar</TH>
          <TH>Status</TH>
        </TR>
      </THead>
      <TBody>
        {items.map((o) => (
          <TR key={o.id} className="cursor-pointer" onClick={() => router.push(`/admin/pedidos/${o.id}`)}>
            <TD className="whitespace-nowrap font-medium">
              <Link href={`/admin/pedidos/${o.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                {o.number}
              </Link>
              {o.recurring && <Repeat className="ml-1 inline size-3.5 text-muted-foreground" aria-label="Recorrente" />}
            </TD>
            {showCustomer && <TD>{o.customerName ?? '—'}</TD>}
            <TD className="whitespace-nowrap">
              {formatScheduleDate(o.scheduledDate)}
              <span className="block text-xs text-muted-foreground">{formatWindow(o.windowStart, o.windowEnd)}</span>
            </TD>
            <TD>{ORDER_TYPE_LABEL[o.type]}</TD>
            <TD className="text-right tabular-nums">{o.totalDelivery || '—'}</TD>
            <TD className="text-right tabular-nums">{o.totalCollection || '—'}</TD>
            <TD>
              <OrderStatusBadge status={o.status} />
              {o.stockOverride && (
                <Badge variant="warning" className="ml-1">
                  Sem estoque
                </Badge>
              )}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

export function OrdersList({ canCreate, initialDateFrom = '', initialDateTo = '' }: { canCreate: boolean; initialDateFrom?: string; initialDateTo?: string }) {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState(initialDateFrom);
  const [dateTo, setDateTo] = useState(initialDateTo);
  const q = useInfiniteQuery({
    queryKey: ['orders', status, search, dateFrom, dateTo],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => {
      const p = new URLSearchParams({ page: String(pageParam) });
      if (status) p.set('status', status);
      if (search.trim()) p.set('search', search.trim());
      if (dateFrom) p.set('dateFrom', dateFrom);
      if (dateTo) p.set('dateTo', dateTo);
      return apiFetch<ListResponse>(`/api/admin/orders?${p}`, { signal });
    },
    getNextPageParam: (last, all) => (last.hasMore ? all.length + 1 : undefined),
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const counts = q.data?.pages[0]?.counts ?? {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <>
      <PageHeader title="Pedidos" description="Entregas e coletas agendadas. Confirmar reserva o estoque; cancelar ou reagendar libera.">
        <div className="flex gap-2">
          <Link href="/admin/pedidos/recorrencias" className={buttonVariants({ variant: 'outline' })}>
            <Repeat aria-hidden /> Recorrências
          </Link>
          {canCreate && (
            <Link href="/admin/pedidos/novo" className={buttonVariants()}>
              <Plus aria-hidden /> Novo pedido
            </Link>
          )}
        </div>
      </PageHeader>

      <div className="mb-3 flex gap-1 overflow-x-auto pb-1" role="group" aria-label="Filtrar por status">
        {FILTERS.map((s) => (
          <button
            key={s || 'all'}
            type="button"
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
            className={cn(
              'whitespace-nowrap rounded-full border px-3 py-1 text-sm',
              status === s ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent',
            )}
          >
            {s ? ORDER_STATUS_LABEL[s] : 'Todos'} <span className="tabular-nums opacity-70">{s ? (counts[s] ?? 0) : total}</span>
          </button>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap gap-3">
        <Input
          type="search"
          aria-label="Buscar por cliente ou número"
          placeholder="Cliente ou nº do pedido"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64"
        />
        <label className="flex items-center gap-2 text-sm">
          De
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          Até
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
        </label>
      </div>

      {q.error && <Alert variant="destructive">{describeApiError(q.error)}</Alert>}
      <Card>
        {q.isPending ? (
          <div className="p-4">
            <Skeleton className="h-6 w-full" />
          </div>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-muted-foreground">Nenhum pedido encontrado.</p>
        ) : (
          <OrdersTable items={items} />
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
