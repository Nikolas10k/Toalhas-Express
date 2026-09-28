'use client';

import { useMutation } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/page-header';
import { ContractForm, type ContractValues } from '@/components/contracts/contract-form';
import type { PickedCustomer } from '@/components/orders/customer-picker';
import { Card, CardContent } from '@/components/ui/card';
import { apiFetch, ApiError, describeApiError } from '@/lib/api-client';

export function NewContract({ initialCustomer }: { initialCustomer: PickedCustomer | null }) {
  const router = useRouter();
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());
  const save = useMutation({
    mutationFn: (body: ContractValues & { customerId?: string }) => apiFetch<{ id: string; number: string }>('/api/admin/contracts', { idempotencyKey: idemKey, body }),
    onSuccess: (r) => {
      toast.success(`Contrato ${r.number} criado como rascunho. Revise e ative.`);
      router.push(`/admin/contratos/${r.id}`);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status < 500) setIdemKey(crypto.randomUUID());
    },
  });
  return (
    <>
      <Link href="/admin/contratos" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Contratos
      </Link>
      <PageHeader title="Novo contrato" description="Nasce como rascunho; só passa a valer quando for ativado." />
      <Card className="max-w-4xl">
        <CardContent className="pt-6">
          <ContractForm withCustomer initialCustomer={initialCustomer} requireReason={false} pending={save.isPending} error={describeApiError(save.error)} submitLabel="Criar rascunho" onSubmit={(v) => save.mutate(v)} />
        </CardContent>
      </Card>
    </>
  );
}
