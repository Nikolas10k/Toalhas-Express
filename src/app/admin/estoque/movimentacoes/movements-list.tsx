'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/page-header';
import { MOVEMENT_LABEL, STATE_LABEL } from '@/components/inventory/labels';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { apiFetch, describeApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/utils';

interface Movement {
  id: string;
  type: string;
  quantity: number;
  from: string;
  to: string;
  productName: string;
  sku: string;
  customerName: string | null;
  reason: string | null;
  reversesMovementId: string | null;
  reversed: boolean;
  actorName: string | null;
  actorType: string;
  occurredAt: string;
}

const REVERSIBLE = new Set(['STOCK_ENTRY', 'MANUAL_ADJUSTMENT', 'TRANSFER', 'DAMAGE', 'LOSS']);

export function MovementsList({ canReverse }: { canReverse: boolean }) {
  const qc = useQueryClient();
  const [productId, setProductId] = useState('');
  const [type, setType] = useState('');
  const [target, setTarget] = useState<Movement | null>(null);
  const [reason, setReason] = useState('');
  const products = useQuery({
    queryKey: ['products', 'all-for-filter'],
    queryFn: ({ signal }) => apiFetch<{ id: string; name: string }[]>('/api/admin/products?includeInactive=true', { signal }),
  });
  const q = useInfiniteQuery({
    queryKey: ['inventory', 'movements', productId, type],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const p = new URLSearchParams({ limit: '50' });
      if (productId) p.set('productId', productId);
      if (type) p.set('type', type);
      if (pageParam) p.set('cursor', pageParam);
      return apiFetch<{ items: Movement[]; nextCursor: string | null }>(`/api/admin/inventory/movements?${p}`, { signal });
    },
    getNextPageParam: (l) => l.nextCursor,
  });
  const reverse = useMutation({
    mutationFn: () => apiFetch(`/api/admin/inventory/movements/${target!.id}/reverse`, { body: { reason } }),
    onSuccess: () => {
      toast.success('Movimento estornado.');
      setTarget(null);
      setReason('');
      qc.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageHeader title="Movimentações" description="Histórico imutável de toda toalha que entrou, saiu ou mudou de estado. Correções são feitas por estorno." />
      <div className="mb-4 flex flex-wrap gap-3">
        <Select aria-label="Filtrar por produto" value={productId} onChange={(e) => setProductId(e.target.value)} className="w-56">
          <option value="">Todos os produtos</option>
          {products.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Filtrar por tipo" value={type} onChange={(e) => setType(e.target.value)} className="w-56">
          <option value="">Todos os tipos</option>
          {Object.entries(MOVEMENT_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </div>
      {q.error && <Alert variant="destructive">{describeApiError(q.error)}</Alert>}
      <Card>
        <Table>
          <THead>
            <TR>
              <TH>Quando</TH>
              <TH>Tipo</TH>
              <TH>Produto</TH>
              <TH className="text-right">Qtd.</TH>
              <TH>De → para</TH>
              <TH>Cliente</TH>
              <TH>Motivo / por</TH>
              <TH>
                <span className="sr-only">Ações</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {q.isPending && (
              <TR>
                <TD colSpan={8}>
                  <Skeleton className="h-6 w-full" />
                </TD>
              </TR>
            )}
            {!q.isPending && items.length === 0 && (
              <TR>
                <TD colSpan={8} className="py-10 text-center text-muted-foreground">
                  Nenhuma movimentação.
                </TD>
              </TR>
            )}
            {items.map((m) => (
              <TR key={m.id}>
                <TD className="whitespace-nowrap">{formatDateTime(m.occurredAt)}</TD>
                <TD>
                  {MOVEMENT_LABEL[m.type] ?? m.type}
                  {m.reversesMovementId && <Badge variant="secondary" className="ml-1">Estorno</Badge>}
                  {m.reversed && <Badge variant="warning" className="ml-1">Estornado</Badge>}
                </TD>
                <TD>{m.productName}</TD>
                <TD className="text-right font-medium tabular-nums">{m.quantity}</TD>
                <TD className="whitespace-nowrap text-sm">
                  {STATE_LABEL[m.from]} → {STATE_LABEL[m.to]}
                </TD>
                <TD>{m.customerName ?? '—'}</TD>
                <TD className="max-w-xs text-sm">
                  <span className="line-clamp-2">{m.reason ?? '—'}</span>
                  <span className="text-xs text-muted-foreground">{m.actorName ?? m.actorType}</span>
                </TD>
                <TD>
                  {canReverse && REVERSIBLE.has(m.type) && !m.reversed && !m.reversesMovementId && (
                    <Button size="sm" variant="ghost" onClick={() => setTarget(m)}>
                      Estornar
                    </Button>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
      {q.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
            Carregar mais
          </Button>
        </div>
      )}
      <Dialog
        open={target !== null}
        onClose={() => setTarget(null)}
        title="Estornar movimento"
        description={
          target
            ? `Um novo movimento devolverá ${target.quantity} × ${target.productName} de "${STATE_LABEL[target.to]}" para "${STATE_LABEL[target.from]}". O original é mantido.`
            : undefined
        }
      >
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); reverse.mutate(); }}>
          <Field id="rev-reason" label="Motivo" required>
            <Input id="rev-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {reverse.error && <Alert variant="destructive">{describeApiError(reverse.error)}</Alert>}
          <div className="flex justify-end">
            <Button type="submit" disabled={reason.trim().length < 5 || reverse.isPending}>
              Estornar
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
