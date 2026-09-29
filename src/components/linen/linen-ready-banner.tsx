'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Shirt } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { formatScheduleDate } from '@/components/orders/labels';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { apiFetch, ApiError, describeApiError } from '@/lib/api-client';

interface ReadyItem {
  id: string;
  number: string;
  customerName: string | null;
  pieces: number;
}

/** Enxoval pronto sem entrega programada: um clique gera os pedidos (confirmados) para a data da rota. */
export function LinenReadyBanner({ date }: { date: string }) {
  const qc = useQueryClient();
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());
  const q = useQuery({
    queryKey: ['linen', 'awaiting-delivery'],
    queryFn: ({ signal }) => apiFetch<{ items: ReadyItem[] }>('/api/admin/linen?awaitingDelivery=true', { signal }),
  });
  const gen = useMutation({
    mutationFn: () => apiFetch<{ created: { number: string }[] }>('/api/admin/linen/deliveries', { idempotencyKey: idemKey, body: { scheduledDate: date } }),
    onSuccess: (r) => {
      toast.success(`${r.created.length} pedido(s) de entrega de enxoval criados para ${formatScheduleDate(date)}.`);
      setIdemKey(crypto.randomUUID());
      qc.invalidateQueries({ queryKey: ['linen'] });
      qc.invalidateQueries({ queryKey: ['plannable'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status < 500) setIdemKey(crypto.randomUUID());
    },
  });
  const items = q.data?.items ?? [];
  if (items.length === 0) return null;
  const customers = new Set(items.map((i) => i.customerName)).size;
  return (
    <Alert className="mb-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm">
          <Shirt className="size-4" aria-hidden />
          {items.length} OS de enxoval pronta(s) de {customers} cliente(s), sem entrega programada.
        </p>
        <Button size="sm" onClick={() => gen.mutate()} disabled={gen.isPending}>
          Gerar entregas para {formatScheduleDate(date)}
        </Button>
      </div>
      {gen.error && <p className="mt-2 text-sm text-destructive">{describeApiError(gen.error)}</p>}
    </Alert>
  );
}
