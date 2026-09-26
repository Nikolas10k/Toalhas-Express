'use client';

import { useQuery } from '@tanstack/react-query';
import { Plus, Repeat } from 'lucide-react';
import Link from 'next/link';
import { OrdersTable, type OrderListItem } from '@/app/admin/pedidos/orders-list';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch, describeApiError } from '@/lib/api-client';

export function OrdersTab({ customerId, canCreate }: { customerId: string; canCreate: boolean }) {
  const q = useQuery({
    queryKey: ['orders', 'customer', customerId],
    queryFn: ({ signal }) => apiFetch<{ items: OrderListItem[]; hasMore: boolean }>(`/api/admin/orders?customerId=${customerId}`, { signal }),
  });
  if (q.error) return <Alert variant="destructive">{describeApiError(q.error)}</Alert>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap justify-end gap-2">
        <Link href="/admin/pedidos/recorrencias" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          <Repeat aria-hidden /> Recorrências
        </Link>
        {canCreate && (
          <Link href="/admin/pedidos/novo" className={buttonVariants({ size: 'sm' })}>
            <Plus aria-hidden /> Novo pedido
          </Link>
        )}
      </div>
      <Card>
        {q.isPending ? (
          <div className="p-4">
            <Skeleton className="h-6 w-full" />
          </div>
        ) : q.data.items.length === 0 ? (
          <p className="py-10 text-center text-muted-foreground">Nenhum pedido para este cliente.</p>
        ) : (
          <OrdersTable items={q.data.items} showCustomer={false} />
        )}
      </Card>
      {q.data?.hasMore && <p className="text-center text-sm text-muted-foreground">Mostrando os 30 mais recentes. Use a tela Pedidos para ver todos.</p>}
    </div>
  );
}
