'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/page-header';
import { LaundryStatusBadge } from '@/components/laundry/labels';
import { formatScheduleDate } from '@/components/orders/labels';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch, ApiError, describeApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/utils';

interface QueueItem {
  productId: string;
  sku: string;
  name: string;
  awaiting: number;
  inLaundry: number;
  inInspection: number;
}

interface PendingReceipt {
  routeId: string;
  date: string;
  driverName: string;
  items: { productId: string; name: string; expected: number }[];
}

interface Overview {
  queue: QueueItem[];
  pendingReceipts: PendingReceipt[];
}

interface BatchItem {
  id: string;
  number: string;
  status: string;
  provider: string | null;
  total: number;
  createdAt: string;
  completedAt: string | null;
}

export function LaundryOverview({ canManage }: { canManage: boolean }) {
  const router = useRouter();
  const [filter, setFilter] = useState('true');
  const [newBatch, setNewBatch] = useState(false);
  const [receiving, setReceiving] = useState<PendingReceipt | null>(null);
  const overview = useQuery({ queryKey: ['laundry', 'overview'], queryFn: ({ signal }) => apiFetch<Overview>('/api/admin/laundry', { signal }) });
  const batches = useInfiniteQuery({
    queryKey: ['laundry', 'batches', filter],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => {
      const p = new URLSearchParams({ page: String(pageParam) });
      if (filter) p.set('open', filter);
      return apiFetch<{ items: BatchItem[]; hasMore: boolean }>(`/api/admin/laundry/batches?${p}`, { signal });
    },
    getNextPageParam: (last, all) => (last.hasMore ? all.length + 1 : undefined),
  });
  const items = batches.data?.pages.flatMap((p) => p.items) ?? [];
  const queue = overview.data?.queue.filter((q) => q.awaiting + q.inLaundry + q.inInspection > 0) ?? [];

  return (
    <>
      <PageHeader title="Lavanderia" description="Coleta → conferência na base → lote (lavar, secar, dobrar, inspecionar) → estoque disponível.">
        {canManage && (
          <Button onClick={() => setNewBatch(true)} disabled={!overview.data?.queue.some((q) => q.awaiting > 0)}>
            <Plus aria-hidden /> Novo lote
          </Button>
        )}
      </PageHeader>
      {overview.error && <Alert variant="destructive">{describeApiError(overview.error)}</Alert>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Fila por produto</CardTitle>
          </CardHeader>
          {overview.isPending ? (
            <CardContent>
              <Skeleton className="h-16 w-full" />
            </CardContent>
          ) : queue.length === 0 ? (
            <CardContent className="text-sm text-muted-foreground">Nenhuma toalha aguardando ou em lavagem.</CardContent>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Produto</TH>
                  <TH className="text-right">Aguardando</TH>
                  <TH className="text-right">Em lavagem</TH>
                  <TH className="text-right">Em inspeção</TH>
                </TR>
              </THead>
              <TBody>
                {queue.map((q) => (
                  <TR key={q.productId}>
                    <TD>{q.name}</TD>
                    <TD className="text-right font-medium tabular-nums">{q.awaiting}</TD>
                    <TD className="text-right tabular-nums">{q.inLaundry}</TD>
                    <TD className="text-right tabular-nums">{q.inInspection}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Conferir chegada das rotas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {overview.data?.pendingReceipts.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma rota com coleta para conferir.</p>}
            {overview.data?.pendingReceipts.map((r) => (
              <div key={r.routeId} className="flex items-center justify-between gap-2 rounded-md border p-3 text-sm">
                <div>
                  <p className="font-medium">
                    Rota de {formatScheduleDate(r.date)} · {r.driverName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Coletadas: {r.items.map((i) => `${i.expected} ${i.name}`).join(', ')}
                  </p>
                </div>
                {canManage && (
                  <Button size="sm" variant="outline" onClick={() => setReceiving(r)}>
                    <ClipboardCheck aria-hidden /> Conferir
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="mb-3 mt-6 flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Lotes</h2>
        <Select aria-label="Filtrar lotes" value={filter} onChange={(e) => setFilter(e.target.value)} className="w-48">
          <option value="true">Em andamento</option>
          <option value="false">Concluídos/cancelados</option>
          <option value="">Todos</option>
        </Select>
      </div>
      {batches.error && <Alert variant="destructive">{describeApiError(batches.error)}</Alert>}
      <Card>
        {batches.isPending ? (
          <div className="p-4">
            <Skeleton className="h-6 w-full" />
          </div>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-muted-foreground">Nenhum lote.</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Lote</TH>
                <TH>Lavanderia</TH>
                <TH className="text-right">Toalhas</TH>
                <TH>Criado</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {items.map((b) => (
                <TR key={b.id} className="cursor-pointer" onClick={() => router.push(`/admin/estoque/lavanderia/${b.id}`)}>
                  <TD className="font-medium">
                    <Link href={`/admin/estoque/lavanderia/${b.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                      {b.number}
                    </Link>
                  </TD>
                  <TD>{b.provider ?? '—'}</TD>
                  <TD className="text-right tabular-nums">{b.total}</TD>
                  <TD className="text-sm">{formatDateTime(b.createdAt)}</TD>
                  <TD>
                    <LaundryStatusBadge status={b.status} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {batches.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={() => batches.fetchNextPage()} disabled={batches.isFetchingNextPage}>
            Carregar mais
          </Button>
        </div>
      )}

      {newBatch && overview.data && <NewBatchDialog queue={overview.data.queue.filter((q) => q.awaiting > 0)} onClose={() => setNewBatch(false)} />}
      {receiving && <ReceiveDialog receipt={receiving} onClose={() => setReceiving(null)} />}
    </>
  );
}

function NewBatchDialog({ queue, onClose }: { queue: QueueItem[]; onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(queue.map((q) => [q.productId, String(q.awaiting)])));
  const [provider, setProvider] = useState('');
  const [notes, setNotes] = useState('');
  const items = queue.map((q) => ({ productId: q.productId, quantity: Math.trunc(Number(qty[q.productId]) || 0) })).filter((i) => i.quantity > 0);
  const over = queue.some((q) => (Number(qty[q.productId]) || 0) > q.awaiting);
  const save = useMutation({
    mutationFn: () => apiFetch<{ id: string; number: string }>('/api/admin/laundry/batches', { idempotencyKey: idemKey, body: { items, provider: provider || null, notes: notes || null } }),
    onSuccess: (r) => {
      toast.success(`Lote ${r.number} criado. As toalhas saíram da fila.`);
      qc.invalidateQueries({ queryKey: ['laundry'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      router.push(`/admin/estoque/lavanderia/${r.id}`);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status < 500) setIdemKey(crypto.randomUUID());
    },
  });
  return (
    <Dialog open onClose={onClose} title="Novo lote de lavagem" description="Escolha quantas toalhas da fila entram neste lote.">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        {queue.map((q) => (
          <Field key={q.productId} id={`b-${q.productId}`} label={`${q.name} (na fila: ${q.awaiting})`}>
            <Input id={`b-${q.productId}`} type="number" inputMode="numeric" min={0} max={q.awaiting} value={qty[q.productId] ?? ''} onChange={(e) => setQty({ ...qty, [q.productId]: e.target.value })} />
          </Field>
        ))}
        <Field id="b-provider" label="Lavanderia" hint="Própria ou terceirizada (opcional).">
          <Input id="b-provider" maxLength={120} value={provider} onChange={(e) => setProvider(e.target.value)} />
        </Field>
        <Field id="b-notes" label="Observações">
          <Textarea id="b-notes" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {over && <Alert variant="destructive">Quantidade maior que a fila.</Alert>}
        {save.error && <Alert variant="destructive">{describeApiError(save.error)}</Alert>}
        <div className="flex justify-end">
          <Button type="submit" disabled={items.length === 0 || over || save.isPending}>
            Criar lote ({items.reduce((a, i) => a + i.quantity, 0)} toalhas)
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ReceiveDialog({ receipt, onClose }: { receipt: PendingReceipt; onClose: () => void }) {
  const qc = useQueryClient();
  const [counted, setCounted] = useState<Record<string, string>>(() => Object.fromEntries(receipt.items.map((i) => [i.productId, String(i.expected)])));
  const [notes, setNotes] = useState('');
  const diffs = receipt.items.filter((i) => Number(counted[i.productId] || 0) !== i.expected);
  const save = useMutation({
    mutationFn: () =>
      apiFetch<{ incidents: string[] }>(`/api/admin/laundry/receipts/${receipt.routeId}`, {
        body: { items: receipt.items.map((i) => ({ productId: i.productId, counted: Math.max(0, Math.trunc(Number(counted[i.productId]) || 0)) })), notes: notes || null },
      }),
    onSuccess: (r) => {
      toast.success(r.incidents.length ? `Conferência registrada com ${r.incidents.length} divergência(s) — veja em Ocorrências.` : 'Conferência registrada: tudo certo.');
      qc.invalidateQueries({ queryKey: ['laundry'] });
      onClose();
    },
  });
  return (
    <Dialog open onClose={onClose} title={`Conferir rota de ${formatScheduleDate(receipt.date)}`} description="Conte o que chegou das coletas. Diferença vira ocorrência; o estoque só muda pela decisão dela.">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        {receipt.items.map((i) => (
          <Field key={i.productId} id={`r-${i.productId}`} label={`${i.name} — coletadas nas paradas: ${i.expected}`}>
            <Input id={`r-${i.productId}`} type="number" inputMode="numeric" min={0} value={counted[i.productId] ?? ''} onChange={(e) => setCounted({ ...counted, [i.productId]: e.target.value })} />
          </Field>
        ))}
        {diffs.length > 0 && <Alert>Será aberta ocorrência de divergência para: {diffs.map((d) => d.name).join(', ')}.</Alert>}
        <Field id="r-notes" label="Observações">
          <Textarea id="r-notes" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {save.error && <Alert variant="destructive">{describeApiError(save.error)}</Alert>}
        <div className="flex justify-end">
          <Button type="submit" disabled={save.isPending}>
            Registrar conferência
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
