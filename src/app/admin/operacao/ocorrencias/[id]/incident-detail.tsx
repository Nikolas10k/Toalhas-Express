'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { AttachmentLinks } from '@/components/operations/attachment-link';
import { DAMAGE_CLASS_LABEL, DECISION_LABEL, INCIDENT_STATUS_LABEL, INCIDENT_TYPE_LABEL, IncidentStatusBadge } from '@/components/operations/labels';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch, describeApiError } from '@/lib/api-client';
import { formatCents } from '@/lib/money-format';
import { formatDateTime } from '@/lib/utils';

interface Detail {
  incident: {
    id: string;
    number: string;
    type: string;
    status: string;
    source: string;
    customerId: string | null;
    customerName: string | null;
    orderId: string | null;
    orderNumber: string | null;
    routeId: string | null;
    productName: string | null;
    quantity: number;
    description: string;
    details: Record<string, unknown>;
    damageClass: string | null;
    decision: string | null;
    chargeAmountCents: number | null;
    assignedName: string | null;
    reporterName: string | null;
    resolution: string | null;
    resolvedAt: string | null;
    createdAt: string;
  };
  replacementPriceCents: number | null;
  customerBalance: number | null;
  events: { id: string; type: string; from: string | null; to: string | null; note: string | null; actorName: string | null; at: string }[];
  attachmentIds: string[];
  billable: { id: string; amountCents: number; status: string } | null;
  actions: { review: boolean; reopen: boolean; cancel: boolean; resolve: boolean; canCharge: boolean; decisions: string[] };
}

interface Preview {
  summary: string;
  movements: { type: string; quantity: number; from: string; to: string }[];
  chargeAmountCents: number | null;
  requiresChargePermission: boolean;
}

const EVENT_LABEL: Record<string, string> = { CREATED: 'Registrada', STATUS_CHANGED: 'Situação alterada', ASSIGNED: 'Responsável definido', RESOLVED: 'Resolvida' };

export function IncidentDetailView({ id }: { id: string }) {
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<'resolve' | 'cancel' | null>(null);
  const q = useQuery({ queryKey: ['incident', id], queryFn: ({ signal }) => apiFetch<Detail>(`/api/admin/incidents/${id}`, { signal }) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['incident', id] });
    qc.invalidateQueries({ queryKey: ['incidents'] });
    qc.invalidateQueries({ queryKey: ['inventory'] });
  };
  const status = useMutation({
    mutationFn: (body: { to: string; note?: string }) => apiFetch(`/api/admin/incidents/${id}/status`, { body }),
    onSuccess: () => {
      toast.success('Situação atualizada.');
      setDialog(null);
      refresh();
    },
    onError: (e) => toast.error(describeApiError(e)),
  });

  if (q.isPending) return <Skeleton className="h-96 w-full" />;
  if (q.error) return <Alert variant="destructive">{describeApiError(q.error)}</Alert>;
  const { incident: i, actions } = q.data;
  const details = i.details as { stage?: string; expected?: number; actual?: number };

  return (
    <>
      <Link href="/admin/operacao/ocorrencias" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Ocorrências
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {i.number} · {INCIDENT_TYPE_LABEL[i.type] ?? i.type}
            </h1>
            <IncidentStatusBadge status={i.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Registrada {formatDateTime(i.createdAt)} por {i.reporterName ?? (i.source === 'SYSTEM' ? 'sistema' : '—')}
            {i.assignedName && ` · responsável: ${i.assignedName}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {actions.review && (
            <Button variant="outline" disabled={status.isPending} onClick={() => status.mutate({ to: 'UNDER_REVIEW' })}>
              Colocar em análise
            </Button>
          )}
          {actions.reopen && (
            <Button variant="outline" disabled={status.isPending} onClick={() => status.mutate({ to: 'OPEN' })}>
              Voltar para aberta
            </Button>
          )}
          {actions.resolve && <Button onClick={() => setDialog('resolve')}>Resolver</Button>}
          {actions.cancel && (
            <Button variant="outline" onClick={() => setDialog('cancel')}>
              Cancelar
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Detalhes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>{i.description}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              {i.customerName && (
                <>
                  <dt className="text-muted-foreground">Cliente</dt>
                  <dd>
                    <Link href={`/admin/clientes/${i.customerId}`} className="hover:underline">
                      {i.customerName}
                    </Link>
                    {q.data.customerBalance !== null && <span className="text-muted-foreground"> · tem {q.data.customerBalance} deste produto</span>}
                  </dd>
                </>
              )}
              {i.orderNumber && (
                <>
                  <dt className="text-muted-foreground">Pedido</dt>
                  <dd>
                    <Link href={`/admin/pedidos/${i.orderId}`} className="hover:underline">
                      {i.orderNumber}
                    </Link>
                    {i.routeId && (
                      <>
                        {' · '}
                        <Link href={`/admin/rotas/${i.routeId}`} className="hover:underline">
                          ver rota
                        </Link>
                      </>
                    )}
                  </dd>
                </>
              )}
              {i.productName && (
                <>
                  <dt className="text-muted-foreground">Produto</dt>
                  <dd>
                    {i.quantity} × {i.productName}
                    {q.data.replacementPriceCents !== null && <span className="text-muted-foreground"> · reposição {formatCents(q.data.replacementPriceCents)} cada</span>}
                  </dd>
                </>
              )}
              {details.stage && (
                <>
                  <dt className="text-muted-foreground">Divergência</dt>
                  <dd>
                    {details.stage === 'COLLECTION' ? 'Coleta' : 'Entrega'}: esperado {details.expected}, realizado {details.actual}
                  </dd>
                </>
              )}
              {i.damageClass && (
                <>
                  <dt className="text-muted-foreground">Dano</dt>
                  <dd>{DAMAGE_CLASS_LABEL[i.damageClass]}</dd>
                </>
              )}
              {i.decision && (
                <>
                  <dt className="text-muted-foreground">Decisão</dt>
                  <dd>
                    {DECISION_LABEL[i.decision]}
                    {i.chargeAmountCents ? ` · cobrança de ${formatCents(i.chargeAmountCents)}` : ''}
                  </dd>
                </>
              )}
              {i.resolution && (
                <>
                  <dt className="text-muted-foreground">Resolução</dt>
                  <dd>{i.resolution}</dd>
                </>
              )}
              {q.data.billable && (
                <>
                  <dt className="text-muted-foreground">Cobrável</dt>
                  <dd>
                    {formatCents(q.data.billable.amountCents)} · {q.data.billable.status === 'PENDING' ? 'aguardando faturamento (Financeiro)' : q.data.billable.status}
                  </dd>
                </>
              )}
            </dl>
            <AttachmentLinks ids={q.data.attachmentIds} />
          </CardContent>
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
                  <p className="font-medium">
                    {EVENT_LABEL[e.type] ?? e.type}
                    {e.to && e.type === 'STATUS_CHANGED' && `: ${INCIDENT_STATUS_LABEL[e.to]}`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(e.at)} · {e.actorName ?? '—'}
                  </p>
                  {e.note && <p className="text-xs">{e.note}</p>}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>

      {dialog === 'resolve' && <ResolveDialog detail={q.data} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); }} />}
      {dialog === 'cancel' && <CancelDialog pending={status.isPending} onClose={() => setDialog(null)} onConfirm={(note) => status.mutate({ to: 'CANCELLED', note })} />}
    </>
  );
}

function ResolveDialog({ detail, onClose, onDone }: { detail: Detail; onClose: () => void; onDone: () => void }) {
  const decisions = detail.actions.decisions;
  const [decision, setDecision] = useState(decisions[0] ?? 'NO_ACTION');
  const [chargeCustomer, setChargeCustomer] = useState(false);
  const [resolution, setResolution] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const body = { decision, resolution, chargeCustomer: decision === 'REGISTER_LOSS' && chargeCustomer };
  const previewM = useMutation({
    mutationFn: () => apiFetch<Preview>(`/api/admin/incidents/${detail.incident.id}/resolve/preview`, { body }),
    onSuccess: setPreview,
  });
  const resolve = useMutation({
    mutationFn: () => apiFetch<{ summary: string }>(`/api/admin/incidents/${detail.incident.id}/resolve`, { body }),
    onSuccess: (r) => {
      toast.success(`Ocorrência resolvida. ${r.summary}`);
      onDone();
    },
  });
  const reset = () => {
    setPreview(null);
    previewM.reset();
    resolve.reset();
  };
  return (
    <Dialog open onClose={onClose} title="Resolver ocorrência" description="Veja o impacto antes de confirmar. A decisão não pode ser desfeita (correções geram novos registros).">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (preview) resolve.mutate();
          else previewM.mutate();
        }}
      >
        <Field id="r-decision" label="Decisão">
          <Select id="r-decision" value={decision} onChange={(e) => { setDecision(e.target.value); reset(); }}>
            {decisions.map((d) => (
              <option key={d} value={d} disabled={d === 'CHARGE_CUSTOMER' && !detail.actions.canCharge}>
                {DECISION_LABEL[d]}
                {d === 'CHARGE_CUSTOMER' && !detail.actions.canCharge ? ' (sem permissão)' : ''}
              </option>
            ))}
          </Select>
        </Field>
        {decision === 'REGISTER_LOSS' && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" checked={chargeCustomer} disabled={!detail.actions.canCharge} onChange={(e) => { setChargeCustomer(e.target.checked); reset(); }} />
            Cobrar o cliente pelo valor de reposição {!detail.actions.canCharge && '(sem permissão para cobrar)'}
          </label>
        )}
        <Field id="r-resolution" label="Resolução" required hint="Fica no histórico e na auditoria.">
          <Textarea id="r-resolution" maxLength={2000} value={resolution} onChange={(e) => { setResolution(e.target.value); reset(); }} />
        </Field>
        {preview && (
          <Alert>
            <p className="font-medium">{preview.summary}</p>
            {preview.chargeAmountCents !== null && <p className="text-sm">Será gerada UMA cobrança de {formatCents(preview.chargeAmountCents)} para faturamento.</p>}
          </Alert>
        )}
        {(previewM.error || resolve.error) && <Alert variant="destructive">{describeApiError(previewM.error ?? resolve.error)}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Voltar
          </Button>
          <Button type="submit" disabled={resolution.trim().length < 3 || previewM.isPending || resolve.isPending}>
            {preview ? 'Confirmar decisão' : 'Ver impacto'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function CancelDialog({ pending, onClose, onConfirm }: { pending: boolean; onClose: () => void; onConfirm: (note: string) => void }) {
  const [note, setNote] = useState('');
  return (
    <Dialog open onClose={onClose} title="Cancelar ocorrência" description="Use quando foi registrada por engano. Nada é movimentado.">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onConfirm(note); }}>
        <Field id="c-note" label="Motivo" required>
          <Textarea id="c-note" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="flex justify-end">
          <Button type="submit" variant="destructive" disabled={note.trim().length < 3 || pending}>
            Cancelar ocorrência
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
