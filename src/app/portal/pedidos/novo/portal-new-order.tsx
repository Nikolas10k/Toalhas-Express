'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { addDaysLocal, todayLocal } from '@/components/orders/labels';
import { itemsPayload, newItem, OrderItemsEditor, type CatalogProduct, type ItemDraft, type OrderType } from '@/components/orders/order-items-editor';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch, ApiError, describeApiError } from '@/lib/api-client';

export function PortalNewOrder() {
  const router = useRouter();
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());
  const [type, setType] = useState<OrderType>('DELIVERY_AND_COLLECTION');
  const [scheduledDate, setScheduledDate] = useState(addDaysLocal(1));
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd] = useState('');
  const [items, setItems] = useState<ItemDraft[]>([newItem()]);
  const [notes, setNotes] = useState('');
  const products = useQuery({
    queryKey: ['portal-products'],
    queryFn: ({ signal }) => apiFetch<CatalogProduct[]>('/api/portal/products', { signal }),
  });
  const create = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string }>('/api/portal/orders', {
        idempotencyKey: idemKey,
        body: {
          type,
          scheduledDate,
          windowStart: windowStart || null,
          windowEnd: windowEnd || null,
          items: itemsPayload(type, items),
          notes: notes || null,
        },
      }),
    onSuccess: (r) => {
      toast.success('Pedido enviado! Avisaremos quando for confirmado.');
      router.push(`/portal/pedidos/${r.id}`);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) setIdemKey(crypto.randomUUID());
    },
  });
  const canSubmit = itemsPayload(type, items).length > 0 && scheduledDate && !create.isPending;

  return (
    <div className="space-y-4">
      <Link href="/portal/pedidos" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Meus pedidos
      </Link>
      <h1 className="text-xl font-semibold">Novo pedido</h1>
      <Card>
        <CardContent className="pt-6">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit) create.mutate();
            }}
          >
            <Field id="p-type" label="O que você precisa?" required>
              <Select id="p-type" value={type} onChange={(e) => setType(e.target.value as OrderType)}>
                <option value="DELIVERY_AND_COLLECTION">Entregar limpas e coletar usadas</option>
                <option value="DELIVERY">Só entregar</option>
                <option value="COLLECTION">Só coletar</option>
              </Select>
            </Field>
            <Field id="p-date" label="Data" required>
              <Input id="p-date" type="date" min={todayLocal()} value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="p-ws" label="A partir de" hint="Opcional">
                <Input id="p-ws" type="time" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} />
              </Field>
              <Field id="p-we" label="Até" hint="Opcional">
                <Input id="p-we" type="time" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} />
              </Field>
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Toalhas</legend>
              {products.error && <Alert variant="destructive">{describeApiError(products.error)}</Alert>}
              <OrderItemsEditor type={type} items={items} products={products.data ?? []} onChange={setItems} />
            </fieldset>
            <Field id="p-notes" label="Observações" hint="Ex.: entregar na portaria dos fundos.">
              <Textarea id="p-notes" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <p className="text-xs text-muted-foreground">A entrega é feita no endereço do seu cadastro. O pedido será confirmado pela nossa equipe.</p>
            {create.error && <Alert variant="destructive">{describeApiError(create.error)}</Alert>}
            <Button type="submit" className="w-full" disabled={!canSubmit}>
              {create.isPending ? 'Enviando…' : 'Enviar pedido'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
