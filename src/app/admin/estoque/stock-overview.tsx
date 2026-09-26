'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRightLeft, Package } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/page-header';
import { STATE_LABEL, STATE_ORDER } from '@/components/inventory/labels';
import { StockOperationDialog } from '@/components/inventory/stock-operation-dialog';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { apiFetch, describeApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/utils';

interface Overview {
  products: {
    id: string;
    sku: string;
    name: string;
    size: string | null;
    active: boolean;
    minStock: number;
    belowMinimum: boolean;
    stock: { total: number; byState: Record<string, number> };
  }[];
  alerts: { id: string; type: string; severity: string; title: string; createdAt: string }[];
}

export function StockOverview({ can }: { can: { move: boolean; adjust: boolean } }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['inventory', 'overview'], queryFn: ({ signal }) => apiFetch<Overview>('/api/admin/inventory/overview', { signal }) });
  const ack = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/admin/inventory/alerts/${id}`, { method: 'PATCH', body: { status: 'ACKNOWLEDGED' } }),
    onSuccess: () => {
      toast.success('Alerta marcado como ciente.');
      qc.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
  const kinds = [...(can.move ? (['entry', 'TRANSFER', 'DAMAGE', 'LOSS', 'DISCARD'] as const) : []), ...(can.adjust ? (['adjust'] as const) : [])];
  const products = q.data?.products.filter((p) => p.active || p.stock.total !== 0) ?? [];
  const totals = STATE_ORDER.map((s) => products.reduce((a, p) => a + (p.stock.byState[s] ?? 0), 0));

  return (
    <>
      <PageHeader title="Estoque" description="Toalhas por estado. Saldos são calculados a partir das movimentações — nunca digitados.">
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/estoque/produtos" className={buttonVariants({ variant: 'outline' })}>
            <Package aria-hidden /> Produtos
          </Link>
          {kinds.length > 0 && (
            <Button onClick={() => setOpen(true)}>
              <ArrowRightLeft aria-hidden /> Movimentar estoque
            </Button>
          )}
        </div>
      </PageHeader>

      {q.data?.alerts.map((a) => (
        <Alert key={a.id} variant={a.severity === 'CRITICAL' ? 'destructive' : 'default'} className="mb-3 flex items-center justify-between gap-3">
          <span>
            <AlertTriangle className="mr-1 inline size-4" aria-hidden /> {a.title}
            <span className="ml-2 text-xs text-muted-foreground">{formatDateTime(a.createdAt)}</span>
          </span>
          {can.adjust && (
            <Button size="sm" variant="ghost" onClick={() => ack.mutate(a.id)}>
              Ciente
            </Button>
          )}
        </Alert>
      ))}
      {q.error && <Alert variant="destructive">{describeApiError(q.error)}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Toalhas por estado</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Produto</TH>
                {STATE_ORDER.map((s) => (
                  <TH key={s} className="text-right whitespace-nowrap">
                    {STATE_LABEL[s]}
                  </TH>
                ))}
                <TH className="text-right">Total</TH>
              </TR>
            </THead>
            <TBody>
              {q.isPending && (
                <TR>
                  <TD colSpan={12}>
                    <Skeleton className="h-6 w-full" />
                  </TD>
                </TR>
              )}
              {!q.isPending && products.length === 0 && (
                <TR>
                  <TD colSpan={12} className="py-10 text-center text-muted-foreground">
                    Nenhum produto. Cadastre em <Link className="text-primary underline" href="/admin/estoque/produtos">Produtos</Link> e registre a entrada de estoque.
                  </TD>
                </TR>
              )}
              {products.map((p) => (
                <TR key={p.id}>
                  <TD>
                    <span className="font-medium">{p.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {p.sku}
                      {p.size ? ` · ${p.size}` : ''}
                    </span>
                    {p.belowMinimum && (
                      <Badge variant="warning" className="mt-1">
                        Abaixo do mínimo ({p.minStock})
                      </Badge>
                    )}
                  </TD>
                  {STATE_ORDER.map((s) => {
                    const v = p.stock.byState[s] ?? 0;
                    return (
                      <TD key={s} className={`text-right tabular-nums ${v === 0 ? 'text-muted-foreground' : ''} ${v < 0 ? 'font-semibold text-destructive' : ''}`}>
                        {v}
                      </TD>
                    );
                  })}
                  <TD className="text-right font-semibold tabular-nums">{p.stock.total}</TD>
                </TR>
              ))}
              {products.length > 1 && (
                <TR className="bg-muted/40 font-medium">
                  <TD>Total</TD>
                  {totals.map((t, i) => (
                    <TD key={STATE_ORDER[i]} className="text-right tabular-nums">
                      {t}
                    </TD>
                  ))}
                  <TD className="text-right tabular-nums">{totals.reduce((a, b) => a + b, 0)}</TD>
                </TR>
              )}
            </TBody>
          </Table>
        </CardContent>
      </Card>
      <p className="mt-3 text-xs text-muted-foreground">
        A soma dos estados sempre fecha com o total. Uma verificação diária compara os saldos com o histórico de movimentações e gera alerta se algo não fechar.
      </p>

      {kinds.length > 0 && <StockOperationDialog open={open} onClose={() => setOpen(false)} allowedKinds={[...kinds]} />}
    </>
  );
}
