'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/admin/page-header';
import { BILLING_TYPE_LABEL, CONTRACT_STATUS_LABEL, ContractStatusBadge } from '@/components/contracts/labels';
import { formatScheduleDate } from '@/components/orders/labels';
import { Alert } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { apiFetch, describeApiError } from '@/lib/api-client';
import { formatCents } from '@/lib/money-format';

export interface ContractItem {
  id: string;
  number: string;
  customerId: string;
  customerName: string | null;
  status: string;
  billingType: string;
  startsOn: string;
  endsOn: string | null;
  dueDay: number;
  monthlyFeeCents: number;
  perDeliveryFeeCents: number;
}

export function ContractsTable({ items, showCustomer = true }: { items: ContractItem[]; showCustomer?: boolean }) {
  const router = useRouter();
  return (
    <Table>
      <THead>
        <TR>
          <TH>Contrato</TH>
          {showCustomer && <TH>Cliente</TH>}
          <TH>Cobrança</TH>
          <TH>Vigência</TH>
          <TH className="text-right">Valor base</TH>
          <TH>Status</TH>
        </TR>
      </THead>
      <TBody>
        {items.map((c) => (
          <TR key={c.id} className="cursor-pointer" onClick={() => router.push(`/admin/contratos/${c.id}`)}>
            <TD className="font-medium">
              <Link href={`/admin/contratos/${c.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                {c.number}
              </Link>
            </TD>
            {showCustomer && <TD>{c.customerName ?? '—'}</TD>}
            <TD className="text-sm">{BILLING_TYPE_LABEL[c.billingType]}</TD>
            <TD className="whitespace-nowrap text-sm">
              {formatScheduleDate(c.startsOn)} – {c.endsOn ? formatScheduleDate(c.endsOn) : 'indeterminado'}
              <span className="block text-xs text-muted-foreground">vence dia {c.dueDay}</span>
            </TD>
            <TD className="text-right tabular-nums">
              {c.monthlyFeeCents ? `${formatCents(c.monthlyFeeCents)}/mês` : c.perDeliveryFeeCents ? `${formatCents(c.perDeliveryFeeCents)}/entrega` : '—'}
            </TD>
            <TD>
              <ContractStatusBadge status={c.status} />
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

export function ContractsList({ canManage }: { canManage: boolean }) {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const q = useInfiniteQuery({
    queryKey: ['contracts', status, search],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => {
      const p = new URLSearchParams({ page: String(pageParam) });
      if (status) p.set('status', status);
      if (search.trim()) p.set('search', search.trim());
      return apiFetch<{ items: ContractItem[]; hasMore: boolean }>(`/api/admin/contracts?${p}`, { signal });
    },
    getNextPageParam: (last, all) => (last.hasMore ? all.length + 1 : undefined),
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <PageHeader title="Contratos" description="Condições de cada cliente: tipo de cobrança, franquia, preços de excedente, perda e dano, vencimento e renovação.">
        {canManage && (
          <Link href="/admin/contratos/novo" className={buttonVariants()}>
            <Plus aria-hidden /> Novo contrato
          </Link>
        )}
      </PageHeader>
      <div className="mb-4 flex flex-wrap gap-3">
        <Input type="search" aria-label="Buscar cliente" placeholder="Cliente" value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
        <Select aria-label="Filtrar por status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-48">
          <option value="">Todos</option>
          {Object.entries(CONTRACT_STATUS_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
      </div>
      {q.error && <Alert variant="destructive">{describeApiError(q.error)}</Alert>}
      <Card>
        {q.isPending ? (
          <div className="p-4">
            <Skeleton className="h-6 w-full" />
          </div>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-muted-foreground">Nenhum contrato.</p>
        ) : (
          <ContractsTable items={items} />
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
