'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { CustomerForm, type CustomerFormValues } from '@/components/customers/customer-form';
import { CustomerStatusBadge } from '@/components/customers/labels';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs } from '@/components/ui/tabs';
import { apiFetch, ApiError, describeApiError } from '@/lib/api-client';
import { formatDocument } from '@/lib/br/documents';
import type { CustomerUpdateData } from '@/lib/validation/customers';
import { AuditTab } from './audit-tab';
import { CommunicationTab } from './communication-tab';
import { LgpdActions } from './lgpd-actions';
import { IncidentsTab, OperationsTab } from './operations-tabs';
import { OrdersTab } from './orders-tab';
import { StatusActions } from './status-actions';
import { SummaryTab } from './summary-tab';
import { TowelsTab } from './towels-tab';
import type { Customer360Data, CustomerDetail, Permissions } from './types';

const FUTURE_TABS: Record<string, { label: string; phase: number; text: string }> = {
  contrato: { label: 'Contrato', phase: 8, text: 'Contrato, franquia e regras de cobrança.' },
  financeiro: { label: 'Financeiro', phase: 9, text: 'Cobranças, pagamentos e inadimplência.' },
};

function toFormValues(c: CustomerDetail): CustomerFormValues {
  const s = (v: string | null) => v ?? '';
  return {
    personType: c.personType,
    legalName: c.legalName,
    tradeName: s(c.tradeName),
    document: formatDocument(c.document),
    contactName: s(c.contactName),
    phone: s(c.phone),
    whatsapp: s(c.whatsapp),
    email: s(c.email),
    postalCode: s(c.postalCode),
    street: s(c.street),
    number: s(c.number),
    complement: s(c.complement),
    district: s(c.district),
    city: s(c.city),
    state: s(c.state),
    preferredChannel: c.preferredChannel,
    whatsappOptIn: c.whatsappOptIn,
    emailOptIn: c.emailOptIn,
    notes: s(c.notes),
  };
}

export function Customer360({ id, can }: { id: string; can: Permissions }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState('resumo');
  const [editing, setEditing] = useState(false);
  const query = useQuery({
    queryKey: ['customer', id],
    queryFn: ({ signal }) => apiFetch<Customer360Data>(`/api/admin/customers/${id}`, { signal }),
  });
  const update = useMutation({
    mutationFn: (patch: CustomerUpdateData) => apiFetch(`/api/admin/customers/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: () => {
      toast.success('Cliente atualizado.');
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['customer', id] });
    },
  });

  if (query.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (query.error) {
    return <Alert variant="destructive">{query.error instanceof ApiError ? query.error.message : 'Não foi possível carregar o cliente.'}</Alert>;
  }
  const { customer: c } = query.data;
  const anonymized = Boolean(c.anonymizedAt);
  const tabs = [
    { id: 'resumo', label: 'Resumo' },
    ...(can.orders ? [{ id: 'pedidos', label: 'Pedidos' }] : []),
    ...(can.inventory ? [{ id: 'toalhas', label: 'Toalhas' }] : []),
    ...(can.routes ? [{ id: 'entregas', label: 'Entregas/Coletas' }] : []),
    ...(can.incidents ? [{ id: 'ocorrencias', label: 'Ocorrências' }] : []),
    ...Object.entries(FUTURE_TABS).map(([tid, t]) => ({ id: tid, label: t.label })),
    { id: 'comunicacao', label: 'Comunicação' },
    ...(can.audit ? [{ id: 'auditoria', label: 'Auditoria' }] : []),
  ];

  return (
    <>
      <Link href="/admin/clientes" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Clientes
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{c.tradeName ?? c.legalName}</h1>
            <CustomerStatusBadge status={c.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {c.tradeName && <>{c.legalName} · </>}
            {c.personType === 'PJ' ? 'CNPJ' : 'CPF'} {formatDocument(c.document) || '—'}
          </p>
          {c.statusReason && <p className="mt-1 text-sm text-muted-foreground">Motivo do status: {c.statusReason}</p>}
        </div>
        {!anonymized && (
          <div className="flex flex-wrap gap-2">
            {can.update && !editing && (
              <Button variant="outline" onClick={() => { setTab('resumo'); setEditing(true); }}>
                <Pencil aria-hidden /> Editar
              </Button>
            )}
            <StatusActions customer={c} can={can} />
            <LgpdActions customer={c} can={can} />
          </div>
        )}
      </div>

      {anonymized && (
        <Alert className="mb-4">Este cliente foi anonimizado (LGPD). Os dados pessoais foram apagados e o cadastro não pode ser alterado.</Alert>
      )}
      {c.status === 'pending' && (
        <Alert className="mb-4">Cadastro aguardando aprovação. O cliente ainda não pode fazer pedidos.</Alert>
      )}

      <Tabs items={tabs} value={tab} onChange={(t) => { setTab(t); setEditing(false); }} />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="pt-6">
        {tab === 'resumo' &&
          (editing ? (
            <Card>
              <CardContent className="pt-6">
                <CustomerForm
                  mode="edit"
                  defaultValues={toFormValues(c)}
                  pending={update.isPending}
                  error={describeApiError(update.error)}
                  onSubmit={(patch) => update.mutate(patch)}
                />
                <div className="mt-2">
                  <Button variant="ghost" onClick={() => setEditing(false)}>
                    Cancelar
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <SummaryTab data={query.data} can={can} />
          ))}
        {FUTURE_TABS[tab] && (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="font-medium">{FUTURE_TABS[tab].text}</p>
              <p className="mt-1 text-sm text-muted-foreground">Disponível a partir da Fase {FUTURE_TABS[tab].phase}.</p>
            </CardContent>
          </Card>
        )}
        {tab === 'toalhas' && can.inventory && (
          <TowelsTab
            customerId={id}
            customerName={c.tradeName ?? c.legalName}
            canAdjust={can.inventoryAdjust && !anonymized}
            canMove={can.inventoryMove && !anonymized}
          />
        )}
        {tab === 'pedidos' && can.orders && <OrdersTab customerId={id} canCreate={can.orderCreate && c.status === 'active' && !anonymized} />}
        {tab === 'entregas' && can.routes && <OperationsTab customerId={id} />}
        {tab === 'ocorrencias' && can.incidents && <IncidentsTab customerId={id} />}
        {tab === 'comunicacao' && <CommunicationTab customer={c} />}
        {tab === 'auditoria' && can.audit && <AuditTab customerId={id} />}
      </div>
    </>
  );
}
