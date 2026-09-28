'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { LAUNDRY_STATUS_LABEL, LAUNDRY_STEPS, LaundryStatusBadge, NEXT_ACTION_LABEL } from '@/components/laundry/labels';
import { DAMAGE_CLASS_LABEL } from '@/components/operations/labels';
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
import { apiFetch, describeApiError } from '@/lib/api-client';
import { cn, formatDateTime } from '@/lib/utils';

interface Detail {
  batch: { id: string; number: string; status: string; provider: string | null; notes: string | null; statusReason: string | null; startedAt: string | null; completedAt: string | null; createdAt: string };
  items: { productId: string; name: string; quantity: number; inspection: { available: number; damaged: number; discarded: number; notes: string | null } | null }[];
  events: { id: string; from: string | null; to: string; note: string | null; actorName: string | null; at: string }[];
  next: string[];
}

type Line = { available: string; damaged: string; discarded: string; notes: string };
const n = (v: string) => Math.max(0, Math.trunc(Number(v) || 0));

export function BatchDetailView({ id }: { id: string }) {
  const qc = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<Record<string, Line>>({});
  const [damageClass, setDamageClass] = useState('');
  const q = useQuery({ queryKey: ['laundry', 'batch', id], queryFn: ({ signal }) => apiFetch<Detail>(`/api/admin/laundry/batches/${id}`, { signal }) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['laundry'] });
    qc.invalidateQueries({ queryKey: ['inventory'] });
  };
  const advance = useMutation({
    mutationFn: (body: { to: string; note?: string | null }) => apiFetch(`/api/admin/laundry/batches/${id}/advance`, { body }),
    onSuccess: (_r, body) => {
      toast.success(body.to === 'CANCELLED' ? 'Lote cancelado. As toalhas voltaram para a fila.' : `Lote em "${LAUNDRY_STATUS_LABEL[body.to]}".`);
      setCancelOpen(false);
      refresh();
    },
  });
  const inspect = useMutation({
    mutationFn: () =>
      apiFetch<{ incidents: string[] }>(`/api/admin/laundry/batches/${id}/inspection`, {
        body: {
          items: q.data!.items.map((i) => {
            const l = line(i);
            return { productId: i.productId, available: n(l.available), damaged: n(l.damaged), discarded: n(l.discarded), notes: l.notes || null };
          }),
          damageClass: damageClass || null,
        },
      }),
    onSuccess: (r) => {
      toast.success(r.incidents.length ? 'Lote concluído. Toalhas com dano viraram ocorrência para decidir o destino.' : 'Lote concluído. Toalhas aprovadas voltaram ao estoque disponível.');
      refresh();
    },
  });
  const line = (i: Detail['items'][number]): Line => lines[i.productId] ?? { available: String(i.quantity), damaged: '0', discarded: '0', notes: '' };
  const setLine = (i: Detail['items'][number], patch: Partial<Line>) => setLines((l) => ({ ...l, [i.productId]: { ...line(i), ...patch } }));

  if (q.isPending) return <Skeleton className="h-96 w-full" />;
  if (q.error) return <Alert variant="destructive">{describeApiError(q.error)}</Alert>;
  const { batch: b, items, next } = q.data;
  const stepIndex = LAUNDRY_STEPS.indexOf(b.status as (typeof LAUNDRY_STEPS)[number]);
  const nextStep = next.find((s) => s in NEXT_ACTION_LABEL);
  const inspecting = b.status === 'INSPECTION' && next.includes('COMPLETED');
  const mismatch = items.filter((i) => {
    const l = line(i);
    return n(l.available) + n(l.damaged) + n(l.discarded) !== i.quantity;
  });
  const anyDamaged = items.some((i) => n(line(i).damaged) > 0);

  return (
    <>
      <Link href="/admin/estoque/lavanderia" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Lavanderia
      </Link>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Lote {b.number}</h1>
            <LaundryStatusBadge status={b.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {b.provider ?? 'Lavanderia não informada'} · criado {formatDateTime(b.createdAt)}
            {b.completedAt && ` · encerrado ${formatDateTime(b.completedAt)}`}
          </p>
          {b.statusReason && <p className="text-sm">Motivo: {b.statusReason}</p>}
        </div>
        <div className="flex gap-2">
          {nextStep && (
            <Button disabled={advance.isPending} onClick={() => advance.mutate({ to: nextStep })}>
              {NEXT_ACTION_LABEL[nextStep]}
            </Button>
          )}
          {next.includes('CANCELLED') && (
            <Button variant="outline" onClick={() => setCancelOpen(true)}>
              Cancelar lote
            </Button>
          )}
        </div>
      </div>
      {advance.error && !cancelOpen && <Alert variant="destructive" className="mb-4">{describeApiError(advance.error)}</Alert>}

      {b.status !== 'CANCELLED' && (
        <ol className="mb-6 flex flex-wrap gap-2" aria-label="Etapas do lote">
          {LAUNDRY_STEPS.map((s, i) => (
            <li
              key={s}
              aria-current={i === stepIndex ? 'step' : undefined}
              className={cn(
                'flex items-center gap-1 rounded-full border px-3 py-1 text-sm',
                i < stepIndex && 'border-success/40 bg-success/10',
                i === stepIndex && 'border-primary bg-primary text-primary-foreground',
              )}
            >
              {i < stepIndex && <Check className="size-3.5" aria-hidden />}
              {LAUNDRY_STATUS_LABEL[s]}
            </li>
          ))}
        </ol>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{inspecting ? 'Inspeção: destino de cada toalha' : 'Itens do lote'}</CardTitle>
          </CardHeader>
          {inspecting ? (
            <CardContent>
              <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); inspect.mutate(); }}>
                {items.map((i) => {
                  const l = line(i);
                  const total = n(l.available) + n(l.damaged) + n(l.discarded);
                  return (
                    <div key={i.productId} className="space-y-2 rounded-md border p-3">
                      <p className="font-medium">
                        {i.name} <span className="text-sm text-muted-foreground">({i.quantity} no lote · somando {total})</span>
                      </p>
                      <div className="grid grid-cols-3 gap-2">
                        <Field id={`a-${i.productId}`} label="Aprovadas">
                          <Input id={`a-${i.productId}`} type="number" inputMode="numeric" min={0} value={l.available} onChange={(e) => setLine(i, { available: e.target.value })} />
                        </Field>
                        <Field id={`d-${i.productId}`} label="Com dano">
                          <Input id={`d-${i.productId}`} type="number" inputMode="numeric" min={0} value={l.damaged} onChange={(e) => setLine(i, { damaged: e.target.value })} />
                        </Field>
                        <Field id={`x-${i.productId}`} label="Descarte">
                          <Input id={`x-${i.productId}`} type="number" inputMode="numeric" min={0} value={l.discarded} onChange={(e) => setLine(i, { discarded: e.target.value })} />
                        </Field>
                      </div>
                      <Input aria-label={`Observação ${i.name}`} placeholder="Observação (opcional)" maxLength={500} value={l.notes} onChange={(e) => setLine(i, { notes: e.target.value })} />
                    </div>
                  );
                })}
                {anyDamaged && (
                  <Field id="dmg-class" label="Tipo de dano predominante" required>
                    <Select id="dmg-class" value={damageClass} onChange={(e) => setDamageClass(e.target.value)}>
                      <option value="">Selecione…</option>
                      {Object.entries(DAMAGE_CLASS_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                {mismatch.length > 0 && <Alert>A soma precisa fechar com o lote: {mismatch.map((m) => m.name).join(', ')}.</Alert>}
                {inspect.error && <Alert variant="destructive">{describeApiError(inspect.error)}</Alert>}
                <div className="flex justify-end">
                  <Button type="submit" disabled={mismatch.length > 0 || (anyDamaged && !damageClass) || inspect.isPending}>
                    Concluir lote
                  </Button>
                </div>
              </form>
            </CardContent>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Produto</TH>
                  <TH className="text-right">No lote</TH>
                  <TH className="text-right">Aprovadas</TH>
                  <TH className="text-right">Com dano</TH>
                  <TH className="text-right">Descarte</TH>
                </TR>
              </THead>
              <TBody>
                {items.map((i) => (
                  <TR key={i.productId}>
                    <TD>{i.name}</TD>
                    <TD className="text-right tabular-nums">{i.quantity}</TD>
                    <TD className="text-right tabular-nums">{i.inspection?.available ?? '—'}</TD>
                    <TD className="text-right tabular-nums">{i.inspection?.damaged ?? '—'}</TD>
                    <TD className="text-right tabular-nums">{i.inspection?.discarded ?? '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Histórico</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3 border-l pl-4">
              {q.data.events.map((e) => (
                <li key={e.id} className="relative text-sm">
                  <span className="absolute -left-[1.3rem] top-1.5 size-2.5 rounded-full bg-primary" aria-hidden />
                  <p className="font-medium">{LAUNDRY_STATUS_LABEL[e.to] ?? e.to}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(e.at)} · {e.actorName ?? '—'}
                  </p>
                  {e.note && <p className="text-xs">{e.note}</p>}
                </li>
              ))}
            </ol>
            {b.notes && <p className="mt-4 text-sm">Observações: {b.notes}</p>}
          </CardContent>
        </Card>
      </div>

      <Dialog open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancelar lote" description="Só antes de começar a lavar. As toalhas voltam para a fila.">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); advance.mutate({ to: 'CANCELLED', note: reason }); }}>
          <Field id="c-reason" label="Motivo" required>
            <Textarea id="c-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {advance.error && <Alert variant="destructive">{describeApiError(advance.error)}</Alert>}
          <div className="flex justify-end">
            <Button type="submit" variant="destructive" disabled={reason.trim().length < 3 || advance.isPending}>
              Cancelar lote
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
