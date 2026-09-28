'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { ContractForm, type ContractValues } from '@/components/contracts/contract-form';
import { BILLING_TYPE_LABEL, CONTRACT_STATUS_LABEL, ContractStatusBadge, RENEWAL_LABEL } from '@/components/contracts/labels';
import { formatScheduleDate, todayLocal } from '@/components/orders/labels';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch, describeApiError } from '@/lib/api-client';
import { formatCents } from '@/lib/money-format';
import { formatDateTime } from '@/lib/utils';

interface Detail {
  contract: ContractValues & {
    id: string;
    number: string;
    customerId: string;
    customerName: string | null;
    status: string;
    statusReason: string | null;
    activatedAt: string | null;
    endedAt: string | null;
    revision: number;
  };
  items: (ContractValues['items'][number] & { productName: string; replacementPriceCents: number })[];
  revisions: { id: string; revision: number; changeType: string; reason: string | null; actorName: string | null; at: string }[];
  actions: { edit: boolean; transitions: string[] };
}

interface Simulation {
  usage: { deliveries: number; deliveredByProduct: Record<string, number> };
  billing: {
    month: string;
    dueDate: string;
    coveredDays: number;
    lines: { kind: string; description: string; quantity: number; unitCents: number; amountCents: number }[];
    subtotalCents: number;
    discountCents: number;
    totalCents: number;
    requiresManual: boolean;
  };
}

const ACTION_LABEL: Record<string, string> = { ACTIVE: 'Ativar', SUSPENDED: 'Suspender', ENDED: 'Encerrar', CANCELLED: 'Cancelar rascunho' };
const CHANGE_LABEL: Record<string, string> = { CREATED: 'Criado', UPDATED: 'Termos alterados', RENEWED: 'Renovado automaticamente' };

export function ContractDetailView({ id }: { id: string }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [transition, setTransition] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [month, setMonth] = useState(todayLocal().slice(0, 7));
  const q = useQuery({ queryKey: ['contract', id], queryFn: ({ signal }) => apiFetch<Detail>(`/api/admin/contracts/${id}`, { signal }) });
  const sim = useQuery({
    queryKey: ['contract', id, 'sim', month],
    enabled: /^\d{4}-\d{2}$/.test(month),
    queryFn: ({ signal }) => apiFetch<Simulation>(`/api/admin/contracts/${id}/simulate?month=${month}`, { signal }),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['contract', id] });
    qc.invalidateQueries({ queryKey: ['contracts'] });
  };
  const update = useMutation({
    mutationFn: (body: ContractValues & { reason?: string | null }) => apiFetch(`/api/admin/contracts/${id}`, { method: 'PUT', body }),
    onSuccess: () => {
      toast.success('Contrato atualizado (nova revisão registrada).');
      setEditing(false);
      refresh();
    },
  });
  const move = useMutation({
    mutationFn: (body: { to: string; reason: string | null }) => apiFetch(`/api/admin/contracts/${id}/transition`, { body }),
    onSuccess: (_r, body) => {
      toast.success(`Contrato ${CONTRACT_STATUS_LABEL[body.to]?.toLowerCase()}.`);
      setTransition(null);
      setReason('');
      refresh();
    },
  });

  if (q.isPending) return <Skeleton className="h-96 w-full" />;
  if (q.error) return <Alert variant="destructive">{describeApiError(q.error)}</Alert>;
  const { contract: c, items, actions } = q.data;
  const showFranchise = c.billingType === 'HYBRID' || c.billingType === 'CUSTOM';

  return (
    <>
      <Link href="/admin/contratos" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Contratos
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Contrato {c.number}</h1>
            <ContractStatusBadge status={c.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            <Link href={`/admin/clientes/${c.customerId}`} className="font-medium text-foreground hover:underline">
              {c.customerName ?? 'Cliente'}
            </Link>{' '}
            · {BILLING_TYPE_LABEL[c.billingType]} · revisão {c.revision}
          </p>
          {c.statusReason && <p className="text-sm">Motivo: {c.statusReason}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {actions.edit && (
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil aria-hidden /> Editar termos
            </Button>
          )}
          {actions.transitions.map((t) => (
            <Button key={t} variant={t === 'ACTIVE' ? 'default' : 'outline'} disabled={move.isPending} onClick={() => (t === 'ACTIVE' ? move.mutate({ to: t, reason: null }) : setTransition(t))}>
              {ACTION_LABEL[t] ?? t}
            </Button>
          ))}
        </div>
      </div>
      {move.error && !transition && <Alert variant="destructive" className="mb-4">{describeApiError(move.error)}</Alert>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Termos</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground">Vigência</dt>
                  <dd>
                    {formatScheduleDate(c.startsOn)} – {c.endsOn ? formatScheduleDate(c.endsOn) : 'indeterminado'}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Renovação</dt>
                  <dd>
                    {RENEWAL_LABEL[c.renewal]}
                    {c.renewal === 'AUTO' && ` (${c.renewalMonths} meses)`}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Vencimento</dt>
                  <dd>Dia {c.dueDay} do mês seguinte</dd>
                </div>
                {c.monthlyFeeCents > 0 && (
                  <div>
                    <dt className="text-muted-foreground">Mensalidade</dt>
                    <dd>
                      {formatCents(c.monthlyFeeCents)}
                      {c.prorateFirstMonth && <span className="text-xs text-muted-foreground"> (proporcional)</span>}
                    </dd>
                  </div>
                )}
                {c.perDeliveryFeeCents > 0 && (
                  <div>
                    <dt className="text-muted-foreground">Por entrega</dt>
                    <dd>{formatCents(c.perDeliveryFeeCents)}</dd>
                  </div>
                )}
                {c.discountBp > 0 && (
                  <div>
                    <dt className="text-muted-foreground">Desconto</dt>
                    <dd>{(c.discountBp / 100).toLocaleString('pt-BR')}%</dd>
                  </div>
                )}
              </dl>
              {c.customTerms && <p className="mt-3 whitespace-pre-line rounded bg-muted p-2 text-sm">{c.customTerms}</p>}
              {c.notes && <p className="mt-3 text-sm text-muted-foreground">Notas internas: {c.notes}</p>}
            </CardContent>
            {items.length > 0 && (
              <Table>
                <THead>
                  <TR>
                    <TH>Produto</TH>
                    <TH className="text-right">Contratado</TH>
                    {showFranchise && <TH className="text-right">Franquia/mês</TH>}
                    {showFranchise && <TH className="text-right">Excedente</TH>}
                    {c.billingType === 'PER_QUANTITY' && <TH className="text-right">Por peça</TH>}
                    <TH className="text-right">Perda</TH>
                    <TH className="text-right">Dano</TH>
                  </TR>
                </THead>
                <TBody>
                  {items.map((i) => (
                    <TR key={i.productId}>
                      <TD>{i.productName}</TD>
                      <TD className="text-right tabular-nums">{i.contractedQuantity}</TD>
                      {showFranchise && <TD className="text-right tabular-nums">{i.franchiseQuantity}</TD>}
                      {showFranchise && <TD className="text-right tabular-nums">{formatCents(i.excessPriceCents)}</TD>}
                      {c.billingType === 'PER_QUANTITY' && <TD className="text-right tabular-nums">{formatCents(i.unitPriceCents)}</TD>}
                      <TD className="text-right tabular-nums">{formatCents(i.lossPriceCents ?? i.replacementPriceCents)}</TD>
                      <TD className="text-right tabular-nums">{formatCents(i.damagePriceCents ?? i.replacementPriceCents)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">Simulação do mês (uso real)</CardTitle>
              <Input type="month" aria-label="Mês de referência" value={month} onChange={(e) => setMonth(e.target.value)} className="w-44" />
            </CardHeader>
            <CardContent className="text-sm">
              {sim.error && <Alert variant="destructive">{describeApiError(sim.error)}</Alert>}
              {sim.isPending ? (
                <Skeleton className="h-20 w-full" />
              ) : sim.data ? (
                <div className="space-y-2">
                  <p className="text-muted-foreground">
                    {sim.data.usage.deliveries} entrega(s) no mês · {Object.values(sim.data.usage.deliveredByProduct).reduce((a, b) => a + b, 0)} toalhas entregues · vencimento{' '}
                    {formatScheduleDate(sim.data.billing.dueDate)}
                  </p>
                  {sim.data.billing.requiresManual && <Alert>Contrato personalizado: os valores variáveis são lançados manualmente no financeiro.</Alert>}
                  <ul className="divide-y rounded-md border">
                    {sim.data.billing.lines.map((l, i) => (
                      <li key={i} className="flex justify-between gap-2 p-2">
                        <span>
                          {l.description}
                          {l.quantity > 1 && <span className="text-muted-foreground"> · {l.quantity} × {formatCents(l.unitCents)}</span>}
                        </span>
                        <span className="tabular-nums">{formatCents(l.amountCents)}</span>
                      </li>
                    ))}
                    {sim.data.billing.lines.length === 0 && <li className="p-2 text-muted-foreground">Nada a cobrar neste mês.</li>}
                    {sim.data.billing.discountCents > 0 && (
                      <li className="flex justify-between p-2">
                        <span>Desconto</span>
                        <span className="tabular-nums">− {formatCents(sim.data.billing.discountCents)}</span>
                      </li>
                    )}
                    <li className="flex justify-between p-2 font-semibold">
                      <span>Total</span>
                      <span className="tabular-nums">{formatCents(sim.data.billing.totalCents)}</span>
                    </li>
                  </ul>
                  <p className="text-xs text-muted-foreground">Mesmo cálculo que o financeiro usará para gerar a cobrança. Perdas e danos são cobrados à parte, pelas ocorrências.</p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Revisões</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3 border-l pl-4">
              {q.data.revisions.map((r) => (
                <li key={r.id} className="relative text-sm">
                  <span className="absolute -left-[1.3rem] top-1.5 size-2.5 rounded-full bg-primary" aria-hidden />
                  <p className="font-medium">
                    Rev. {r.revision} · {CHANGE_LABEL[r.changeType] ?? CONTRACT_STATUS_LABEL[r.changeType.replace('STATUS_', '')] ?? r.changeType}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(r.at)} · {r.actorName ?? 'Sistema'}
                  </p>
                  {r.reason && <p className="text-xs">{r.reason}</p>}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>

      <Dialog open={editing} onClose={() => setEditing(false)} title="Editar termos" description={c.status === 'DRAFT' ? undefined : 'Contrato vigente: a alteração gera nova revisão e exige motivo.'} className="max-w-4xl">
        {editing && (
          <ContractForm
            initial={{ ...c, items }}
            withCustomer={false}
            requireReason={c.status !== 'DRAFT'}
            pending={update.isPending}
            error={describeApiError(update.error)}
            submitLabel="Salvar alteração"
            onSubmit={(v) => update.mutate(v)}
          />
        )}
      </Dialog>
      <Dialog open={transition !== null} onClose={() => setTransition(null)} title={transition ? ACTION_LABEL[transition] ?? '' : ''}>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); move.mutate({ to: transition!, reason }); }}>
          <Field id="t-reason" label="Motivo" required>
            <Textarea id="t-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {move.error && <Alert variant="destructive">{describeApiError(move.error)}</Alert>}
          <div className="flex justify-end">
            <Button type="submit" variant="destructive" disabled={reason.trim().length < 3 || move.isPending}>
              Confirmar
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
