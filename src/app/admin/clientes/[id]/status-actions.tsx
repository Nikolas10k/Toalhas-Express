'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch, describeApiError } from '@/lib/api-client';
import type { CustomerDetail, Permissions } from './types';

type Action = 'approve' | 'reject' | 'suspend' | 'reactivate' | 'inactivate';

const ACTIONS: Record<Action, { label: string; from: CustomerDetail['status'][]; perm: keyof Permissions; variant: 'default' | 'outline' | 'destructive'; impact: string }> = {
  approve: { label: 'Aprovar', from: ['pending'], perm: 'approve', variant: 'default', impact: 'O cliente passa a poder fazer pedidos.' },
  reject: { label: 'Recusar', from: ['pending'], perm: 'approve', variant: 'outline', impact: 'O cadastro fica inativo e o cliente não poderá fazer pedidos.' },
  suspend: { label: 'Suspender', from: ['active'], perm: 'update', variant: 'outline', impact: 'Novos pedidos ficam bloqueados até a reativação. Nada é apagado.' },
  reactivate: { label: 'Reativar', from: ['suspended', 'inactive'], perm: 'update', variant: 'outline', impact: 'O cliente volta a poder fazer pedidos.' },
  inactivate: { label: 'Inativar', from: ['active', 'suspended'], perm: 'update', variant: 'outline', impact: 'O cliente deixa de ser atendido. O histórico é mantido.' },
};

export function StatusActions({ customer, can }: { customer: CustomerDetail; can: Permissions }) {
  const qc = useQueryClient();
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState('');
  const mutation = useMutation({
    mutationFn: () => apiFetch(`/api/admin/customers/${customer.id}/status`, { body: { action, reason } }),
    onSuccess: () => {
      toast.success('Status atualizado.');
      setAction(null);
      setReason('');
      qc.invalidateQueries({ queryKey: ['customer', customer.id] });
      qc.invalidateQueries({ queryKey: ['customers'] });
    },
  });
  const available = (Object.keys(ACTIONS) as Action[]).filter((a) => ACTIONS[a].from.includes(customer.status) && can[ACTIONS[a].perm]);
  const name = customer.tradeName ?? customer.legalName;
  return (
    <>
      {available.map((a) => (
        <Button key={a} variant={ACTIONS[a].variant} onClick={() => setAction(a)}>
          {ACTIONS[a].label}
        </Button>
      ))}
      <Dialog
        open={action !== null}
        onClose={() => setAction(null)}
        title={action ? `${ACTIONS[action].label} ${name}?` : ''}
        description={action ? ACTIONS[action].impact : undefined}
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <Field id="status-reason" label="Motivo" required hint="Fica registrado na auditoria.">
            <Textarea id="status-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          </Field>
          {mutation.error && <Alert variant="destructive">{describeApiError(mutation.error)}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAction(null)}>
              Voltar
            </Button>
            <Button type="submit" disabled={reason.trim().length < 3 || mutation.isPending}>
              Confirmar
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
