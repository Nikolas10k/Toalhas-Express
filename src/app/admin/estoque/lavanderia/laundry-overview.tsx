'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, ClipboardList, PackageCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/page-header';
import { ServiceOrderStatusBadge } from '@/components/linen/labels';
import { DAMAGE_CLASS_LABEL } from '@/components/operations/labels';
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
import { Tabs } from '@/components/ui/tabs';
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

interface ServiceOrder {
  id: string;
  number: string;
  customerId: string;
  customerName: string | null;
  status: string;
  collectedAt: string;
  readyAt: string | null;
  deliveredAt: string | null;
  deliveryOrder: { id: string; number: string; status: string | null } | null;
  pieces: number;
  lines: { productId: string; name: string; collected: number; returned: number | null }[];
}

interface BatchItem {
  id: string;
  number: string;
  status: string;
  total: number;
  createdAt: string;
  completedAt: string | null;
}

const num = (v: string | undefined) => Math.max(0, Math.trunc(Number(v) || 0));

export function LaundryOverview({ canManage }: { canManage: boolean }) {
  const [tab, setTab] = useState('aluguel');
  return (
    <>
      <PageHeader title="Lavanderia" description="Toalhas de aluguel: lance o que saiu pronto. Enxoval de clientes: marque a OS como pronta." />
      <Tabs
        items={[
          { id: 'aluguel', label: 'Toalhas de aluguel' },
          { id: 'enxoval', label: 'Enxoval de clientes' },
          { id: 'historico', label: 'Histórico de produção' },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="pt-6">
        {tab === 'aluguel' && <RentalTab canManage={canManage} />}
        {tab === 'enxoval' && <LinenTab canManage={canManage} />}
        {tab === 'historico' && <HistoryTab />}
      </div>
    </>
  );
}

// -----------------------------------------------------------------------------
// Toalhas de aluguel: fila + lançar produção + informar diferença (opcional)
// -----------------------------------------------------------------------------

function RentalTab({ canManage }: { canManage: boolean }) {
  const [producing, setProducing] = useState(false);
  const [receiving, setReceiving] = useState<PendingReceipt | null>(null);
  const overview = useQuery({ queryKey: ['laundry', 'overview'], queryFn: ({ signal }) => apiFetch<Overview>('/api/admin/laundry', { signal }) });
  const queue = overview.data?.queue.filter((q) => q.awaiting > 0) ?? [];
  const total = queue.reduce((a, q) => a + q.awaiting, 0);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {overview.error && <Alert variant="destructive">{describeApiError(overview.error)}</Alert>}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">Aguardando lavagem ({total})</CardTitle>
          {canManage && (
            <Button onClick={() => setProducing(true)} disabled={queue.length === 0}>
              <PackageCheck aria-hidden /> Lançar produção
            </Button>
          )}
        </CardHeader>
        {overview.isPending ? (
          <CardContent>
            <Skeleton className="h-16 w-full" />
          </CardContent>
        ) : queue.length === 0 ? (
          <CardContent className="text-sm text-muted-foreground">Nenhuma toalha suja aguardando.</CardContent>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Produto</TH>
                <TH className="text-right">Sujas</TH>
              </TR>
            </THead>
            <TBody>
              {queue.map((q) => (
                <TR key={q.productId}>
                  <TD>{q.name}</TD>
                  <TD className="text-right font-medium tabular-nums">{q.awaiting}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <CardContent className="pt-3 text-xs text-muted-foreground">
          As coletas entram aqui sozinhas, pela contagem do motorista. Ao sair um carrinho limpo e dobrado, toque em <strong>Lançar produção</strong>.
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Chegadas recentes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">Só use se as sacas não baterem com a contagem do motorista.</p>
          {overview.data?.pendingReceipts.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma rota com coleta nos últimos dias.</p>}
          {overview.data?.pendingReceipts.map((r) => (
            <div key={r.routeId} className="flex items-center justify-between gap-2 rounded-md border p-3 text-sm">
              <div>
                <p className="font-medium">
                  Rota de {formatScheduleDate(r.date)} · {r.driverName}
                </p>
                <p className="text-xs text-muted-foreground">Motorista contou: {r.items.map((i) => `${i.expected} ${i.name}`).join(', ')}</p>
              </div>
              {canManage && (
                <Button size="sm" variant="outline" onClick={() => setReceiving(r)}>
                  Informar diferença
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {producing && <ProductionDialog queue={queue} onClose={() => setProducing(false)} />}
      {receiving && <ReceiveDialog receipt={receiving} onClose={() => setReceiving(null)} />}
    </div>
  );
}

type ProdLine = { available: string; damaged: string; discarded: string };

function ProductionDialog({ queue, onClose }: { queue: QueueItem[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());
  const [lines, setLines] = useState<Record<string, ProdLine>>({});
  const [damageClass, setDamageClass] = useState('');
  const [notes, setNotes] = useState('');
  const line = (id: string): ProdLine => lines[id] ?? { available: '', damaged: '', discarded: '' };
  const set = (id: string, k: keyof ProdLine, v: string) => setLines({ ...lines, [id]: { ...line(id), [k]: v } });
  const items = queue
    .map((q) => ({ productId: q.productId, available: num(line(q.productId).available), damaged: num(line(q.productId).damaged), discarded: num(line(q.productId).discarded), notes: null }))
    .filter((i) => i.available + i.damaged + i.discarded > 0);
  const over = queue.filter((q) => {
    const l = line(q.productId);
    return num(l.available) + num(l.damaged) + num(l.discarded) > q.awaiting;
  });
  const damaged = items.some((i) => i.damaged > 0);
  const save = useMutation({
    mutationFn: () => apiFetch<{ number: string; incidents: string[] }>('/api/admin/laundry/production', { idempotencyKey: idemKey, body: { items, damageClass: damageClass || null, notes: notes || null } }),
    onSuccess: (r) => {
      const ok = items.reduce((a, i) => a + i.available, 0);
      toast.success(`${ok} toalha(s) de volta ao estoque (${r.number}).${r.incidents.length ? ' Dano registrado em Ocorrências.' : ''}`);
      qc.invalidateQueries({ queryKey: ['laundry'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status < 500) setIdemKey(crypto.randomUUID());
    },
  });
  return (
    <Dialog open onClose={onClose} title="Lançar produção" description="O que saiu limpo e dobrado agora. Boas voltam ao estoque na hora.">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        {queue.map((q) => (
          <fieldset key={q.productId} className="rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">
              {q.name} <span className="font-normal text-muted-foreground">(sujas: {q.awaiting})</span>
            </legend>
            <div className="grid grid-cols-3 gap-2">
              <Field id={`p-${q.productId}-ok`} label="Boas">
                <Input id={`p-${q.productId}-ok`} type="number" inputMode="numeric" min={0} value={line(q.productId).available} onChange={(e) => set(q.productId, 'available', e.target.value)} />
              </Field>
              <Field id={`p-${q.productId}-dmg`} label="Com dano">
                <Input id={`p-${q.productId}-dmg`} type="number" inputMode="numeric" min={0} value={line(q.productId).damaged} onChange={(e) => set(q.productId, 'damaged', e.target.value)} />
              </Field>
              <Field id={`p-${q.productId}-disc`} label="Descarte">
                <Input id={`p-${q.productId}-disc`} type="number" inputMode="numeric" min={0} value={line(q.productId).discarded} onChange={(e) => set(q.productId, 'discarded', e.target.value)} />
              </Field>
            </div>
          </fieldset>
        ))}
        {damaged && (
          <Field id="p-class" label="Tipo de dano">
            <Select id="p-class" value={damageClass} onChange={(e) => setDamageClass(e.target.value)} required>
              <option value="">Selecione…</option>
              {Object.entries(DAMAGE_CLASS_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field id="p-notes" label="Observações">
          <Textarea id="p-notes" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {over.length > 0 && <Alert variant="destructive">Mais do que as sujas registradas: {over.map((o) => o.name).join(', ')}.</Alert>}
        {save.error && <Alert variant="destructive">{describeApiError(save.error)}</Alert>}
        <div className="flex justify-end">
          <Button type="submit" disabled={items.length === 0 || over.length > 0 || (damaged && !damageClass) || save.isPending}>
            Lançar ({items.reduce((a, i) => a + i.available + i.damaged + i.discarded, 0)} toalhas)
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
  const diffs = receipt.items.filter((i) => num(counted[i.productId]) !== i.expected);
  const save = useMutation({
    mutationFn: () =>
      apiFetch<{ incidents: string[] }>(`/api/admin/laundry/receipts/${receipt.routeId}`, {
        body: { items: receipt.items.map((i) => ({ productId: i.productId, counted: num(counted[i.productId]) })), notes: notes || null },
      }),
    onSuccess: (r) => {
      toast.success(r.incidents.length ? `Diferença registrada em ${r.incidents.length} ocorrência(s).` : 'Registrado: bateu com o motorista.');
      qc.invalidateQueries({ queryKey: ['laundry'] });
      onClose();
    },
  });
  return (
    <Dialog open onClose={onClose} title={`Diferença na rota de ${formatScheduleDate(receipt.date)}`} description="Informe quantas chegaram de fato. A diferença vira ocorrência; o estoque só muda pela decisão dela.">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        {receipt.items.map((i) => (
          <Field key={i.productId} id={`r-${i.productId}`} label={`${i.name} — motorista contou ${i.expected}`}>
            <Input id={`r-${i.productId}`} type="number" inputMode="numeric" min={0} value={counted[i.productId] ?? ''} onChange={(e) => setCounted({ ...counted, [i.productId]: e.target.value })} />
          </Field>
        ))}
        <Field id="r-notes" label="Observações">
          <Textarea id="r-notes" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {save.error && <Alert variant="destructive">{describeApiError(save.error)}</Alert>}
        <div className="flex justify-end">
          <Button type="submit" disabled={save.isPending || diffs.length === 0}>
            Registrar diferença
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// Enxoval de clientes (OS)
// -----------------------------------------------------------------------------

export function ServiceOrdersList({ customerId, canManage, status }: { customerId?: string; canManage: boolean; status?: string }) {
  const [ready, setReady] = useState<ServiceOrder | null>(null);
  const q = useInfiniteQuery({
    queryKey: ['linen', 'list', customerId ?? '', status ?? ''],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => {
      const p = new URLSearchParams({ page: String(pageParam) });
      if (customerId) p.set('customerId', customerId);
      if (status) p.set('status', status);
      return apiFetch<{ items: ServiceOrder[]; hasMore: boolean }>(`/api/admin/linen?${p}`, { signal });
    },
    getNextPageParam: (last, all) => (last.hasMore ? all.length + 1 : undefined),
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  if (q.error) return <Alert variant="destructive">{describeApiError(q.error)}</Alert>;
  return (
    <>
      <Card>
        {q.isPending ? (
          <div className="p-4">
            <Skeleton className="h-6 w-full" />
          </div>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-muted-foreground">Nenhuma ordem de serviço.</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>OS</TH>
                {!customerId && <TH>Cliente</TH>}
                <TH>Peças</TH>
                <TH>Coletada</TH>
                <TH>Status</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {items.map((s) => (
                <TR key={s.id}>
                  <TD className="font-medium">{s.number}</TD>
                  {!customerId && <TD>{s.customerName ?? '—'}</TD>}
                  <TD className="text-sm">{s.lines.map((l) => `${l.collected} ${l.name}`).join(', ')}</TD>
                  <TD className="whitespace-nowrap text-sm">{formatDateTime(s.collectedAt)}</TD>
                  <TD>
                    <ServiceOrderStatusBadge status={s.status} />
                    {s.status === 'READY' && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {s.deliveryOrder ? (
                          <Link href={`/admin/pedidos/${s.deliveryOrder.id}`} className="hover:underline">
                            Entrega {s.deliveryOrder.number}
                          </Link>
                        ) : (
                          'Aguardando programar entrega'
                        )}
                      </p>
                    )}
                  </TD>
                  <TD className="text-right">
                    {canManage && s.status === 'COLLECTED' && (
                      <Button size="sm" onClick={() => setReady(s)}>
                        <CheckCheck aria-hidden /> Pronta
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {q.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
            Carregar mais
          </Button>
        </div>
      )}
      {ready && <ReadyDialog so={ready} onClose={() => setReady(null)} />}
    </>
  );
}

function LinenTab({ canManage }: { canManage: boolean }) {
  const [status, setStatus] = useState('COLLECTED');
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Roupa de hotéis e spas. O motorista abre a OS na coleta; aqui ela sai como pronta.</p>
        <Select aria-label="Filtrar OS" value={status} onChange={(e) => setStatus(e.target.value)} className="w-52">
          <option value="COLLECTED">Na lavanderia</option>
          <option value="READY">Prontas</option>
          <option value="DELIVERED">Entregues</option>
          <option value="">Todas</option>
        </Select>
      </div>
      <ServiceOrdersList canManage={canManage} status={status || undefined} />
    </>
  );
}

function ReadyDialog({ so, onClose }: { so: ServiceOrder; onClose: () => void }) {
  const qc = useQueryClient();
  const [returned, setReturned] = useState<Record<string, string>>(() => Object.fromEntries(so.lines.map((l) => [l.productId, String(l.collected)])));
  const [note, setNote] = useState('');
  const missing = so.lines.reduce((a, l) => a + Math.max(0, l.collected - num(returned[l.productId])), 0);
  const save = useMutation({
    mutationFn: () =>
      apiFetch<{ incidents: string[] }>(`/api/admin/linen/${so.id}/ready`, {
        body: { items: so.lines.map((l) => ({ productId: l.productId, returned: num(returned[l.productId]) })), divergenceNote: note || null },
      }),
    onSuccess: (r) => {
      toast.success(r.incidents.length ? `${so.number} pronta, com falta registrada em Ocorrências.` : `${so.number} pronta para entregar.`);
      qc.invalidateQueries({ queryKey: ['linen'] });
      onClose();
    },
  });
  return (
    <Dialog open onClose={onClose} title={`${so.number} pronta`} description={`${so.customerName ?? ''} · confira as peças que saíram. Já vem preenchido com o que foi coletado.`}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        {so.lines.map((l) => (
          <Field key={l.productId} id={`so-${l.productId}`} label={`${l.name} — coletadas ${l.collected}`}>
            <Input id={`so-${l.productId}`} type="number" inputMode="numeric" min={0} max={l.collected} value={returned[l.productId] ?? ''} onChange={(e) => setReturned({ ...returned, [l.productId]: e.target.value })} />
          </Field>
        ))}
        {missing > 0 && (
          <Field id="so-note" label={`Faltam ${missing} peça(s) do cliente — o que aconteceu?`}>
            <Textarea id="so-note" required minLength={5} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        )}
        {save.error && <Alert variant="destructive">{describeApiError(save.error)}</Alert>}
        <div className="flex justify-end">
          <Button type="submit" disabled={save.isPending || (missing > 0 && note.trim().length < 5)}>
            <ClipboardList aria-hidden /> Confirmar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// Histórico de produção (lotes)
// -----------------------------------------------------------------------------

function HistoryTab() {
  const batches = useInfiniteQuery({
    queryKey: ['laundry', 'batches', 'all'],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => apiFetch<{ items: BatchItem[]; hasMore: boolean }>(`/api/admin/laundry/batches?page=${pageParam}`, { signal }),
    getNextPageParam: (last, all) => (last.hasMore ? all.length + 1 : undefined),
  });
  const items = batches.data?.pages.flatMap((p) => p.items) ?? [];
  if (batches.error) return <Alert variant="destructive">{describeApiError(batches.error)}</Alert>;
  return (
    <>
      <Card>
        {batches.isPending ? (
          <div className="p-4">
            <Skeleton className="h-6 w-full" />
          </div>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-muted-foreground">Nenhuma produção lançada.</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Registro</TH>
                <TH className="text-right">Toalhas</TH>
                <TH>Quando</TH>
              </TR>
            </THead>
            <TBody>
              {items.map((b) => (
                <TR key={b.id}>
                  <TD className="font-medium">
                    <Link href={`/admin/estoque/lavanderia/${b.id}`} className="hover:underline">
                      {b.number}
                    </Link>
                  </TD>
                  <TD className="text-right tabular-nums">{b.total}</TD>
                  <TD className="text-sm">{formatDateTime(b.completedAt ?? b.createdAt)}</TD>
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
    </>
  );
}
