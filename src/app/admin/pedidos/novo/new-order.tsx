'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/page-header';
import { CustomerPicker, type PickedCustomer } from '@/components/orders/customer-picker';
import { todayLocal } from '@/components/orders/labels';
import { itemsPayload, newItem, OrderItemsEditor, type CatalogProduct, type ItemDraft, type OrderType } from '@/components/orders/order-items-editor';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch, ApiError, describeApiError } from '@/lib/api-client';

export function NewOrder({ canConfirm }: { canConfirm: boolean }) {
  const router = useRouter();
  // Uma chave por intenção: duplo clique ou retry não criam dois pedidos.
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [type, setType] = useState<OrderType>('DELIVERY_AND_COLLECTION');
  const [scheduledDate, setScheduledDate] = useState(todayLocal());
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd] = useState('');
  const [items, setItems] = useState<ItemDraft[]>([newItem()]);
  const [notes, setNotes] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [confirmNow, setConfirmNow] = useState(false);
  const products = useQuery({
    queryKey: ['products', 'active'],
    queryFn: ({ signal }) => apiFetch<CatalogProduct[]>('/api/admin/products', { signal }),
  });
  const create = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string; number: string }>('/api/admin/orders', {
        idempotencyKey: idemKey,
        body: {
          customerId: customer!.id,
          type,
          scheduledDate,
          windowStart: windowStart || null,
          windowEnd: windowEnd || null,
          items: itemsPayload(type, items),
          notes: notes || null,
          internalNotes: internalNotes || null,
          confirmNow,
        },
      }),
    onSuccess: (r) => {
      toast.success(confirmNow ? 'Pedido criado e confirmado.' : 'Pedido criado.');
      router.push(`/admin/pedidos/${r.id}`);
    },
    // Erro de regra/validação: nada foi gravado, então a próxima tentativa usa chave nova.
    onError: (e) => {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) setIdemKey(crypto.randomUUID());
    },
  });
  const payloadItems = itemsPayload(type, items);
  const canSubmit = customer && payloadItems.length > 0 && scheduledDate && !create.isPending;

  return (
    <>
      <Link href="/admin/pedidos" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Pedidos
      </Link>
      <PageHeader title="Novo pedido" description="O endereço de entrega é copiado do cadastro do cliente no momento da criação." />
      <Card className="max-w-3xl">
        <CardContent className="pt-6">
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit) create.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="customer-search">
                Cliente <span className="text-destructive">*</span>
              </Label>
              <CustomerPicker value={customer} onChange={setCustomer} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="type" label="Tipo" required>
                <Select id="type" value={type} onChange={(e) => setType(e.target.value as OrderType)}>
                  <option value="DELIVERY_AND_COLLECTION">Entrega e coleta</option>
                  <option value="DELIVERY">Só entrega</option>
                  <option value="COLLECTION">Só coleta</option>
                </Select>
              </Field>
              <Field id="date" label="Data" required>
                <Input id="date" type="date" min={todayLocal()} value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
              </Field>
              <Field id="ws" label="Janela — início" hint="Opcional">
                <Input id="ws" type="time" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} />
              </Field>
              <Field id="we" label="Janela — fim" hint="Opcional">
                <Input id="we" type="time" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} />
              </Field>
            </div>
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium">
                Itens <span className="text-destructive">*</span>
              </legend>
              {products.error && <Alert variant="destructive">{describeApiError(products.error)}</Alert>}
              {products.data && products.data.length === 0 && <Alert>Cadastre produtos em Estoque → Produtos antes de criar pedidos.</Alert>}
              <OrderItemsEditor type={type} items={items} products={products.data ?? []} onChange={setItems} />
            </fieldset>
            <Field id="notes" label="Observações para o cliente/motorista">
              <Textarea id="notes" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <Field id="internal" label="Notas internas" hint="Não aparecem para o cliente.">
              <Textarea id="internal" maxLength={1000} value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} />
            </Field>
            {canConfirm && (
              <label className="flex items-center gap-3 text-sm">
                <Switch checked={confirmNow} onCheckedChange={setConfirmNow} aria-label="Confirmar agora" />
                Confirmar agora (reserva o estoque imediatamente)
              </label>
            )}
            {create.error && <Alert variant="destructive">{describeApiError(create.error)}</Alert>}
            <div className="flex justify-end gap-2">
              <Button type="submit" disabled={!canSubmit}>
                {create.isPending ? 'Salvando…' : 'Criar pedido'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
