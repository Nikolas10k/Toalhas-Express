'use client';

import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { ContractsTable, type ContractItem } from '@/app/admin/contratos/contracts-list';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch, describeApiError } from '@/lib/api-client';

export function ContractTab({ customerId, canCreate }: { customerId: string; canCreate: boolean }) {
  const q = useQuery({
    queryKey: ['contracts', 'customer', customerId],
    queryFn: ({ signal }) => apiFetch<{ items: ContractItem[] }>(`/api/admin/contracts?customerId=${customerId}`, { signal }),
  });
  if (q.error) return <Alert variant="destructive">{describeApiError(q.error)}</Alert>;
  const hasCurrent = q.data?.items.some((c) => c.status === 'ACTIVE' || c.status === 'SUSPENDED');
  return (
    <div className="space-y-3">
      {canCreate && !hasCurrent && (
        <Link href={`/admin/contratos/novo?customerId=${customerId}`} className={buttonVariants()}>
          <Plus aria-hidden /> Novo contrato
        </Link>
      )}
      <Card>
        {q.isPending ? (
          <div className="p-4">
            <Skeleton className="h-6 w-full" />
          </div>
        ) : q.data.items.length === 0 ? (
          <p className="py-10 text-center text-muted-foreground">Nenhum contrato para este cliente.</p>
        ) : (
          <ContractsTable items={q.data.items} showCustomer={false} />
        )}
      </Card>
    </div>
  );
}
