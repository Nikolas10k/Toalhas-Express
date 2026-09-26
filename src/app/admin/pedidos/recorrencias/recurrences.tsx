'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/page-header';
import { CustomerPicker, type PickedCustomer } from '@/components/orders/customer-picker';
import { ORDER_TYPE_LABEL, WEEKDAY_SHORT, formatScheduleDate, formatWindow, todayLocal } from '@/components/orders/labels';
import { itemsPayload, newItem, OrderItemsEditor, type CatalogProduct, type ItemDraft, type OrderType } from '@/components/orders/order-items-editor';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { apiFetch, describeApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface Rule {
  id: string;
  customerId: string;
  customerName: string | null;
  type: string;
  weekdays: number[];
  windowStart: string | null;
  windowEnd: string | null;
  items: { productId: string; deliveryQuantity: number; collectionQuantity: number }[];
  startsOn: string;
  endsOn: string | null;
  active: boolean;
}

export function Recurrences({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const rules = useQuery({
    queryKey: ['order-recurrences'],
    queryFn: ({ signal }) => apiFetch<Rule[]>('/api/admin/order-recurrences', { signal }),
  });
  const products = useQuery({
    queryKey: ['products', 'all-for-filter'],
    queryFn: ({ signal }) => apiFetch<CatalogProduct[]>('/api/admin/products?includeInactive=true', { signal }),
  });
  const toggle = useMutation({
    mutationFn: (r: Rule) => apiFetch(`/api/admin/order-recurrences/${r.id}`, { method: 'PATCH', body: { active: !r.active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['order-recurrences'] }),
    onError: (e) => toast.error(describeApiError(e)),
  });
  const productName = new Map(products.data?.map((p) => [p.id, p.name]));

  return (
    <>
      <Link href="/admin/pedidos" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Pedidos
      </Link>
      <PageHeader
        title="Recorrências"
        description="Pedidos fixos por dia da semana. O sistema gera os pedidos dos próximos 7 dias diariamente, sem duplicar."
      >
        {canManage && (
          <Button onClick={() => setOpen(true)}>
            <Plus aria-hidden /> Nova recorrência
          </Button>
        )}
      </PageHeader>
      {rules.error && <Alert variant="destructive">{describeApiError(rules.error)}</Alert>}
      <Card>
        {rules.isPending ? (
          <div className="p-4">
            <Skeleton className="h-6 w-full" />
          </div>
        ) : rules.data?.length === 0 ? (
          <p className="py-10 text-center text-muted-foreground">Nenhuma recorrência cadastrada.</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Cliente</TH>
                <TH>Dias</TH>
                <TH>Tipo / janela</TH>
                <TH>Itens</TH>
                <TH>Vigência</TH>
                <TH>Ativa</TH>
              </TR>
            </THead>
            <TBody>
              {rules.data?.map((r) => (
                <TR key={r.id} className={cn(!r.active && 'opacity-60')}>
                  <TD>
                    <Link href={`/admin/clientes/${r.customerId}`} className="hover:underline">
                      {r.customerName ?? '—'}
                    </Link>
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {r.weekdays.map((d) => (
                        <Badge key={d} variant="secondary">
                          {WEEKDAY_SHORT[d]}
                        </Badge>
                      ))}
                    </div>
                  </TD>
                  <TD className="text-sm">
                    {ORDER_TYPE_LABEL[r.type]}
                    <span className="block text-xs text-muted-foreground">{formatWindow(r.windowStart, r.windowEnd)}</span>
                  </TD>
                  <TD className="text-sm">
                    {r.items.map((i) => (
                      <span key={i.productId} className="block">
                        {productName.get(i.productId) ?? 'Produto'}: {i.deliveryQuantity ? `↓${i.deliveryQuantity}` : ''} {i.collectionQuantity ? `↑${i.collectionQuantity}` : ''}
                      </span>
                    ))}
                  </TD>
                  <TD className="whitespace-nowrap text-sm">
                    {formatScheduleDate(r.startsOn)} – {r.endsOn ? formatScheduleDate(r.endsOn) : 'sem fim'}
                  </TD>
                  <TD>
                    <Switch
                      checked={r.active}
                      disabled={!canManage || toggle.isPending}
                      onCheckedChange={() => toggle.mutate(r)}
                      aria-label={r.active ? 'Desativar recorrência' : 'Ativar recorrência'}
                    />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {canManage && (
        <NewRuleDialog
          open={open}
          onClose={() => setOpen(false)}
          products={(products.data ?? []).filter((p) => (p as CatalogProduct & { active?: boolean }).active !== false)}
          onCreated={() => {
            setOpen(false);
            toast.success('Recorrência criada. Os pedidos serão gerados na próxima execução diária.');
            qc.invalidateQueries({ queryKey: ['order-recurrences'] });
          }}
        />
      )}
    </>
  );
}

function NewRuleDialog({ open, onClose, products, onCreated }: { open: boolean; onClose: () => void; products: CatalogProduct[]; onCreated: () => void }) {
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [type, setType] = useState<OrderType>('DELIVERY_AND_COLLECTION');
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [ws, setWs] = useState('');
  const [we, setWe] = useState('');
  const [items, setItems] = useState<ItemDraft[]>([newItem()]);
  const [startsOn, setStartsOn] = useState(todayLocal());
  const [endsOn, setEndsOn] = useState('');
  const create = useMutation({
    mutationFn: () =>
      apiFetch('/api/admin/order-recurrences', {
        body: {
          customerId: customer!.id,
          type,
          weekdays,
          windowStart: ws || null,
          windowEnd: we || null,
          items: itemsPayload(type, items),
          startsOn,
          endsOn: endsOn || null,
        },
      }),
    onSuccess: () => {
      setCustomer(null);
      setWeekdays([]);
      setItems([newItem()]);
      onCreated();
    },
  });
  const canSubmit = customer && weekdays.length > 0 && itemsPayload(type, items).length > 0 && startsOn && !create.isPending;

  return (
    <Dialog open={open} onClose={onClose} title="Nova recorrência" className="max-w-2xl">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) create.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="customer-search">Cliente</Label>
          <CustomerPicker value={customer} onChange={setCustomer} />
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Dias da semana</legend>
          <div className="flex flex-wrap gap-1">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={weekdays.includes(d)}
                onClick={() => setWeekdays((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d].sort()))}
                className={cn('rounded-md border px-3 py-1.5 text-sm', weekdays.includes(d) ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent')}
              >
                {WEEKDAY_SHORT[d]}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="r-type" label="Tipo">
            <Select id="r-type" value={type} onChange={(e) => setType(e.target.value as OrderType)}>
              <option value="DELIVERY_AND_COLLECTION">Entrega e coleta</option>
              <option value="DELIVERY">Só entrega</option>
              <option value="COLLECTION">Só coleta</option>
            </Select>
          </Field>
          <Field id="r-ws" label="Janela — início">
            <Input id="r-ws" type="time" value={ws} onChange={(e) => setWs(e.target.value)} />
          </Field>
          <Field id="r-we" label="Janela — fim">
            <Input id="r-we" type="time" value={we} onChange={(e) => setWe(e.target.value)} />
          </Field>
          <Field id="r-start" label="Começa em">
            <Input id="r-start" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
          </Field>
          <Field id="r-end" label="Termina em" hint="Opcional">
            <Input id="r-end" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
          </Field>
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Itens</legend>
          <OrderItemsEditor type={type} items={items} products={products} onChange={setItems} />
        </fieldset>
        {create.error && <Alert variant="destructive">{describeApiError(create.error)}</Alert>}
        <div className="flex justify-end">
          <Button type="submit" disabled={!canSubmit}>
            Criar recorrência
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
