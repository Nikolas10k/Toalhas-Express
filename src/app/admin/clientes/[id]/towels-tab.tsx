'use client';

import { useQuery } from '@tanstack/react-query';
import { SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { StockOperationDialog } from '@/components/inventory/stock-operation-dialog';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { apiFetch, describeApiError } from '@/lib/api-client';
import { formatCents } from '@/lib/money-format';
import { formatDateTime } from '@/lib/utils';

interface Balance {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  replacementPriceCents: number;
  lastDeliveryAt: string | null;
  lastCollectionAt: string | null;
}

export function TowelsTab({ customerId, customerName, canAdjust, canMove }: { customerId: string; customerName: string; canAdjust: boolean; canMove: boolean }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['customer-balances', customerId],
    queryFn: ({ signal }) => apiFetch<Balance[]>(`/api/admin/customers/${customerId}/balances`, { signal }),
  });
  if (q.error) return <Alert variant="destructive">{describeApiError(q.error)}</Alert>;
  const total = q.data?.reduce((a, b) => a + b.quantity, 0) ?? 0;
  const value = q.data?.reduce((a, b) => a + b.quantity * b.replacementPriceCents, 0) ?? 0;
  const kinds = [...(canAdjust ? (['adjust'] as const) : []), ...(canMove ? (['LOSS', 'DAMAGE'] as const) : [])];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          <strong>{total}</strong> toalha(s) em posse do cliente · valor de reposição {formatCents(value)}
        </p>
        {kinds.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <SlidersHorizontal aria-hidden /> Ajustar saldo / registrar perda
          </Button>
        )}
      </div>
      <Card>
        <Table>
          <THead>
            <TR>
              <TH>Produto</TH>
              <TH className="text-right">Em posse</TH>
              <TH>Última entrega</TH>
              <TH>Última coleta</TH>
            </TR>
          </THead>
          <TBody>
            {q.isPending && (
              <TR>
                <TD colSpan={4}>
                  <Skeleton className="h-5 w-full" />
                </TD>
              </TR>
            )}
            {q.data?.length === 0 && (
              <TR>
                <TD colSpan={4} className="py-8 text-center text-muted-foreground">
                  Nenhuma toalha com este cliente.
                </TD>
              </TR>
            )}
            {q.data?.map((b) => (
              <TR key={b.productId}>
                <TD>
                  {b.name} <span className="text-xs text-muted-foreground">{b.sku}</span>
                </TD>
                <TD className={`text-right font-medium tabular-nums ${b.quantity < 0 ? 'text-destructive' : ''}`}>{b.quantity}</TD>
                <TD>{b.lastDeliveryAt ? formatDateTime(b.lastDeliveryAt) : '—'}</TD>
                <TD>{b.lastCollectionAt ? formatDateTime(b.lastCollectionAt) : '—'}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
      <p className="text-xs text-muted-foreground">Saldo = entregues − coletadas ± ajustes autorizados. Nunca é digitado diretamente.</p>
      {kinds.length > 0 && (
        <StockOperationDialog
          open={open}
          onClose={() => setOpen(false)}
          allowedKinds={[...kinds]}
          defaults={{ customerId, customerName, state: 'WITH_CUSTOMER' }}
        />
      )}
    </div>
  );
}
