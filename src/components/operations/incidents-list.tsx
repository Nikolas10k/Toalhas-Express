'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/admin/page-header';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { apiFetch, describeApiError } from '@/lib/api-client';
import { formatCents } from '@/lib/money-format';
import { formatDateTime } from '@/lib/utils';
import { INCIDENT_STATUS_LABEL, INCIDENT_TYPE_LABEL, IncidentStatusBadge } from './labels';
import { NewIncidentDialog } from './new-incident-dialog';

export interface IncidentItem {
  id: string;
  number: string;
  type: string;
  status: string;
  customerId: string | null;
  customerName: string | null;
  orderNumber: string | null;
  productName: string | null;
  quantity: number;
  description: string;
  decision: string | null;
  chargeAmountCents: number | null;
  assignedName: string | null;
  createdAt: string;
}

export function IncidentsTable({ items, showCustomer = true }: { items: IncidentItem[]; showCustomer?: boolean }) {
  const router = useRouter();
  return (
    <Table>
      <THead>
        <TR>
          <TH>Ocorrência</TH>
          <TH>Tipo</TH>
          {showCustomer && <TH>Cliente</TH>}
          <TH>Descrição</TH>
          <TH className="text-right">Qtd.</TH>
          <TH>Status</TH>
        </TR>
      </THead>
      <TBody>
        {items.map((i) => (
          <TR key={i.id} className="cursor-pointer" onClick={() => router.push(`/admin/operacao/ocorrencias/${i.id}`)}>
            <TD className="whitespace-nowrap">
              <Link href={`/admin/operacao/ocorrencias/${i.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                {i.number}
              </Link>
              <span className="block text-xs text-muted-foreground">{formatDateTime(i.createdAt)}</span>
            </TD>
            <TD>{INCIDENT_TYPE_LABEL[i.type] ?? i.type}</TD>
            {showCustomer && <TD>{i.customerName ?? '—'}</TD>}
            <TD className="max-w-md text-sm">
              <span className="line-clamp-2">{i.description}</span>
              {i.chargeAmountCents !== null && i.chargeAmountCents > 0 && <span className="text-xs text-muted-foreground">Cobrança: {formatCents(i.chargeAmountCents)}</span>}
            </TD>
            <TD className="text-right tabular-nums">{i.quantity || '—'}</TD>
            <TD>
              <IncidentStatusBadge status={i.status} />
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

export function IncidentsList({ group, canReport }: { group?: 'loss_damage'; canReport: boolean }) {
  const [status, setStatus] = useState('open');
  const [type, setType] = useState('');
  const [creating, setCreating] = useState(false);
  const q = useInfiniteQuery({
    queryKey: ['incidents', group ?? 'all', status, type],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => {
      const p = new URLSearchParams({ page: String(pageParam) });
      if (status === 'open') p.set('open', 'true');
      else if (status) p.set('status', status);
      if (type) p.set('type', type);
      if (group) p.set('group', group);
      return apiFetch<{ items: IncidentItem[]; hasMore: boolean; counts: { open: number; review: number } }>(`/api/admin/incidents?${p}`, { signal });
    },
    getNextPageParam: (last, all) => (last.hasMore ? all.length + 1 : undefined),
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const counts = q.data?.pages[0]?.counts;
  return (
    <>
      <PageHeader
        title={group ? 'Perdas e danos' : 'Ocorrências'}
        description={
          group
            ? 'Toalhas danificadas, perdidas, não devolvidas e divergências de coleta. Cada decisão movimenta o estoque e, se for o caso, gera uma única cobrança.'
            : `Problemas nas paradas, divergências, danos e perdas.${counts ? ` ${counts.open} aberta(s), ${counts.review} em análise.` : ''}`
        }
      >
        {canReport && (
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden /> Nova ocorrência
          </Button>
        )}
      </PageHeader>
      <div className="mb-4 flex flex-wrap gap-3">
        <Select aria-label="Filtrar por situação" value={status} onChange={(e) => setStatus(e.target.value)} className="w-48">
          <option value="open">Em aberto</option>
          <option value="">Todas</option>
          {Object.entries(INCIDENT_STATUS_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
        {!group && (
          <Select aria-label="Filtrar por tipo" value={type} onChange={(e) => setType(e.target.value)} className="w-56">
            <option value="">Todos os tipos</option>
            {Object.entries(INCIDENT_TYPE_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        )}
      </div>
      {q.error && <Alert variant="destructive">{describeApiError(q.error)}</Alert>}
      <Card>
        {q.isPending ? (
          <div className="p-4">
            <Skeleton className="h-6 w-full" />
          </div>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-muted-foreground">Nenhuma ocorrência.</p>
        ) : (
          <IncidentsTable items={items} />
        )}
      </Card>
      {q.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
            Carregar mais
          </Button>
        </div>
      )}
      {creating && <NewIncidentDialog onClose={() => setCreating(false)} />}
    </>
  );
}
