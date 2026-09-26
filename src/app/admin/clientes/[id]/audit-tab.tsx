'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { apiFetch, describeApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/utils';

interface Item {
  id: string;
  actorType: string;
  actorName: string | null;
  action: string;
  before: unknown;
  after: unknown;
  metadata: Record<string, unknown>;
  createdAt: string;
}

const ACTION_LABEL: Record<string, string> = {
  'customer.created': 'Cadastro criado',
  'customer.updated': 'Dados alterados',
  'customer.updated_by_customer': 'Alterado pelo cliente',
  'customer.status_changed': 'Status alterado',
  'customer.location_corrected': 'Localização ajustada',
  'customer.geocoded': 'Localização automática',
  'customer.geocode_requested': 'Localização solicitada',
  'customer.portal_user_invited': 'Acesso ao portal',
  'customer.data_exported': 'Dados exportados (LGPD)',
  'customer.anonymized': 'Anonimizado (LGPD)',
  'customer.self_signup': 'Auto cadastro',
};

export function AuditTab({ customerId }: { customerId: string }) {
  const q = useInfiniteQuery({
    queryKey: ['customer-audit', customerId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      apiFetch<{ items: Item[]; nextCursor: string | null }>(
        `/api/admin/customers/${customerId}/audit${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`,
        { signal },
      ),
    getNextPageParam: (l) => l.nextCursor,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  if (q.error) return <Alert variant="destructive">{describeApiError(q.error)}</Alert>;
  return (
    <div className="space-y-3">
      <Card>
        <Table>
          <THead>
            <TR>
              <TH>Quando</TH>
              <TH>Quem</TH>
              <TH>O quê</TH>
              <TH>Detalhes</TH>
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
            {!q.isPending && items.length === 0 && (
              <TR>
                <TD colSpan={4} className="py-8 text-center text-muted-foreground">
                  Sem registros.
                </TD>
              </TR>
            )}
            {items.map((i) => (
              <TR key={i.id}>
                <TD className="whitespace-nowrap">{formatDateTime(i.createdAt)}</TD>
                <TD>
                  <Badge variant="secondary">{i.actorType}</Badge> {i.actorName ?? ''}
                </TD>
                <TD>{ACTION_LABEL[i.action] ?? i.action}</TD>
                <TD className="max-w-md">
                  <code className="block truncate text-xs" title={JSON.stringify({ antes: i.before, depois: i.after, ...i.metadata })}>
                    {JSON.stringify(i.after ?? i.metadata)}
                  </code>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
      {q.hasNextPage && (
        <Button variant="outline" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
          Carregar mais
        </Button>
      )}
    </div>
  );
}
