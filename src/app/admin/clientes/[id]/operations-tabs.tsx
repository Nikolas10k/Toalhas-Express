'use client';

import { useQuery } from '@tanstack/react-query';
import { IncidentsTable, type IncidentItem } from '@/components/operations/incidents-list';
import { OperationsTable, type OperationItem } from '@/components/operations/operations-list';
import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch, describeApiError } from '@/lib/api-client';

export function OperationsTab({ customerId }: { customerId: string }) {
  const q = useQuery({
    queryKey: ['operations', 'customer', customerId],
    queryFn: ({ signal }) => apiFetch<{ items: OperationItem[] }>(`/api/admin/operations?customerId=${customerId}`, { signal }),
  });
  if (q.error) return <Alert variant="destructive">{describeApiError(q.error)}</Alert>;
  return (
    <Card>
      {q.isPending ? (
        <div className="p-4">
          <Skeleton className="h-6 w-full" />
        </div>
      ) : q.data.items.length === 0 ? (
        <p className="py-10 text-center text-muted-foreground">Nenhuma entrega ou coleta registrada.</p>
      ) : (
        <OperationsTable items={q.data.items} showCustomer={false} />
      )}
    </Card>
  );
}

export function IncidentsTab({ customerId }: { customerId: string }) {
  const q = useQuery({
    queryKey: ['incidents', 'customer', customerId],
    queryFn: ({ signal }) => apiFetch<{ items: IncidentItem[] }>(`/api/admin/incidents?customerId=${customerId}`, { signal }),
  });
  if (q.error) return <Alert variant="destructive">{describeApiError(q.error)}</Alert>;
  return (
    <Card>
      {q.isPending ? (
        <div className="p-4">
          <Skeleton className="h-6 w-full" />
        </div>
      ) : q.data.items.length === 0 ? (
        <p className="py-10 text-center text-muted-foreground">Nenhuma ocorrência para este cliente.</p>
      ) : (
        <IncidentsTable items={q.data.items} showCustomer={false} />
      )}
    </Card>
  );
}
