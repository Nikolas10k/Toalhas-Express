'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch, ApiError, describeApiError } from '@/lib/api-client';
import type { CustomerDetail, Permissions } from './types';

export function LgpdActions({ customer, can }: { customer: CustomerDetail; can: Permissions }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState('');

  const exportData = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/customers/${customer.id}/export`, { credentials: 'same-origin' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new ApiError(res.status, body?.error?.code ?? 'UNKNOWN', body?.error?.message ?? 'Falha na exportação.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cliente-${customer.id}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
    onSuccess: () => toast.success('Dados exportados.'),
    onError: (e) => toast.error(describeApiError(e)),
  });

  const anonymize = useMutation({
    mutationFn: () => apiFetch(`/api/admin/customers/${customer.id}/anonymize`, { body: { reason, confirm } }),
    onSuccess: () => {
      toast.success('Cliente anonimizado.');
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['customer', customer.id] });
    },
  });

  if (!can.exportData && !can.anonymize) return null;
  return (
    <>
      {can.exportData && (
        <Button variant="ghost" onClick={() => exportData.mutate()} disabled={exportData.isPending} title="Exportar dados pessoais (LGPD)">
          <Download aria-hidden /> Exportar dados
        </Button>
      )}
      {can.anonymize && (
        <Button variant="ghost" className="text-destructive" onClick={() => setOpen(true)}>
          <ShieldAlert aria-hidden /> Anonimizar
        </Button>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Anonimizar dados pessoais"
        description={`Nome, documento, contatos, endereço e observações de "${customer.tradeName ?? customer.legalName}" serão apagados de forma irreversível. Pedidos e registros financeiros continuam guardados pelo prazo legal, sem dados pessoais. O cliente ficará inativo.`}
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            anonymize.mutate();
          }}
        >
          <Field id="anon-reason" label="Motivo (ex.: solicitação do titular)" required>
            <Textarea id="anon-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </Field>
          <Field id="anon-confirm" label='Digite "ANONIMIZAR" para confirmar' required>
            <Input id="anon-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
          </Field>
          {anonymize.error && <Alert variant="destructive">{describeApiError(anonymize.error)}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Voltar
            </Button>
            <Button type="submit" variant="destructive" disabled={confirm !== 'ANONIMIZAR' || reason.trim().length < 5 || anonymize.isPending}>
              Anonimizar definitivamente
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
