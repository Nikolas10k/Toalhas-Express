'use client';

import { useMutation } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/page-header';
import { CustomerForm } from '@/components/customers/customer-form';
import { Card, CardContent } from '@/components/ui/card';
import { apiFetch, describeApiError } from '@/lib/api-client';
import type { CustomerCreateData } from '@/lib/validation/customers';

export function NewCustomer() {
  const router = useRouter();
  // Uma chave por abertura do formulário: duplo clique/retry não duplica o cliente.
  const [idempotencyKey] = useState(() => `customer-create-${crypto.randomUUID()}`);
  const mutation = useMutation({
    mutationFn: (data: CustomerCreateData) =>
      apiFetch<{ id: string }>('/api/admin/customers', { body: data, idempotencyKey }),
    onSuccess: ({ id }) => {
      toast.success('Cliente cadastrado.');
      router.push(`/admin/clientes/${id}`);
    },
  });
  return (
    <>
      <Link href="/admin/clientes" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Clientes
      </Link>
      <PageHeader title="Novo cliente" description="Clientes cadastrados pela equipe já entram ativos." />
      <Card>
        <CardContent className="pt-6">
          <CustomerForm
            mode="create"
            pending={mutation.isPending}
            error={describeApiError(mutation.error)}
            onSubmit={(v) => mutation.mutate(v)}
          />
        </CardContent>
      </Card>
    </>
  );
}
