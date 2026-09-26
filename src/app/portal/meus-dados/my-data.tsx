'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { CHANNEL_LABEL } from '@/components/customers/labels';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch, describeApiError } from '@/lib/api-client';
import { formatAddress } from '@/lib/br/address';
import { formatDocument } from '@/lib/br/documents';
import { formatPhone } from '@/lib/br/phone';
import { portalCustomerUpdateSchema } from '@/lib/validation/customers';

interface Own {
  legalName: string;
  tradeName: string | null;
  document: string | null;
  contactName: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  preferredChannel: keyof typeof CHANNEL_LABEL;
  whatsappOptIn: boolean;
  emailOptIn: boolean;
}

export function MyData() {
  const q = useQuery({ queryKey: ['own-customer'], queryFn: ({ signal }) => apiFetch<Own>('/api/portal/customer', { signal }) });
  if (q.isPending) return <Skeleton className="h-96 w-full" />;
  if (q.error) return <Alert variant="destructive">{describeApiError(q.error)}</Alert>;
  return <MyDataView c={q.data} />;
}

function MyDataView({ c }: { c: Own }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    contactName: c.contactName ?? '',
    phone: formatPhone(c.phone),
    whatsapp: formatPhone(c.whatsapp),
    email: c.email ?? '',
    preferredChannel: c.preferredChannel as string,
    whatsappOptIn: c.whatsappOptIn,
    emailOptIn: c.emailOptIn,
  });
  const [clientError, setClientError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: unknown) => apiFetch('/api/portal/customer', { method: 'PATCH', body }),
    onSuccess: () => {
      toast.success('Dados atualizados.');
      qc.invalidateQueries({ queryKey: ['own-customer'] });
    },
  });

  return (
    <div className="space-y-4">
      <Link href="/portal" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Início
      </Link>
      <h1 className="text-xl font-semibold">Meus dados</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cadastro</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p className="font-medium">{c.tradeName ?? c.legalName}</p>
          <p className="text-muted-foreground">{formatDocument(c.document)}</p>
          <p className="text-muted-foreground">{formatAddress(c) || 'Endereço não informado'}</p>
          <p className="pt-2 text-xs text-muted-foreground">Para alterar razão social, documento ou endereço, fale com a Toalhas Express.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contato e avisos</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const parsed = portalCustomerUpdateSchema.safeParse(form);
              if (!parsed.success) {
                setClientError(parsed.error.issues[0]?.message ?? 'Dados inválidos.');
                return;
              }
              setClientError(null);
              save.mutate(form);
            }}
          >
            <Field id="contactName" label="Responsável">
              <Input id="contactName" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
            </Field>
            <Field id="whatsapp" label="WhatsApp">
              <Input id="whatsapp" type="tel" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} />
            </Field>
            <Field id="phone" label="Telefone">
              <Input id="phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field id="email" label="E-mail para avisos">
              <Input id="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field id="preferredChannel" label="Como prefere ser avisado">
              <Select id="preferredChannel" value={form.preferredChannel} onChange={(e) => setForm({ ...form, preferredChannel: e.target.value })}>
                {Object.entries(CHANNEL_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" checked={form.whatsappOptIn} onChange={(e) => setForm({ ...form, whatsappOptIn: e.target.checked })} />
              Aceito receber avisos pelo WhatsApp
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" checked={form.emailOptIn} onChange={(e) => setForm({ ...form, emailOptIn: e.target.checked })} />
              Aceito receber avisos por e-mail
            </label>
            {(clientError || save.error) && <Alert variant="destructive">{clientError ?? describeApiError(save.error)}</Alert>}
            <Button type="submit" className="w-full" disabled={save.isPending}>
              {save.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
