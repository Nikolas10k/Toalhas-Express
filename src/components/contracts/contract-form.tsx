'use client';

import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { CustomerPicker, type PickedCustomer } from '@/components/orders/customer-picker';
import { todayLocal } from '@/components/orders/labels';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch } from '@/lib/api-client';
import { centsToInput, parseBRLToCents } from '@/lib/money-format';
import { BILLING_TYPE_LABEL, RENEWAL_LABEL } from './labels';

export interface ContractValues {
  billingType: string;
  startsOn: string;
  endsOn: string | null;
  renewal: string;
  renewalMonths: number;
  dueDay: number;
  monthlyFeeCents: number;
  perDeliveryFeeCents: number;
  discountBp: number;
  prorateFirstMonth: boolean;
  customTerms: string | null;
  notes: string | null;
  items: {
    productId: string;
    contractedQuantity: number;
    franchiseQuantity: number;
    unitPriceCents: number;
    excessPriceCents: number;
    lossPriceCents: number | null;
    damagePriceCents: number | null;
  }[];
}

interface ItemDraft {
  key: string;
  productId: string;
  contracted: string;
  franchise: string;
  unit: string;
  excess: string;
  loss: string;
  damage: string;
}

const intOf = (v: string) => Math.max(0, Math.trunc(Number(v) || 0));

export function ContractForm({
  initial,
  initialCustomer = null,
  withCustomer,
  requireReason,
  pending,
  error,
  submitLabel,
  onSubmit,
}: {
  initial?: ContractValues;
  initialCustomer?: PickedCustomer | null;
  withCustomer: boolean;
  requireReason: boolean;
  pending: boolean;
  error: string | null;
  submitLabel: string;
  onSubmit: (values: ContractValues & { customerId?: string; reason?: string | null }) => void;
}) {
  const [customer, setCustomer] = useState<PickedCustomer | null>(initialCustomer);
  const [billingType, setBillingType] = useState(initial?.billingType ?? 'HYBRID');
  const [startsOn, setStartsOn] = useState(initial?.startsOn ?? todayLocal());
  const [endsOn, setEndsOn] = useState(initial?.endsOn ?? '');
  const [renewal, setRenewal] = useState(initial?.renewal ?? 'MANUAL');
  const [renewalMonths, setRenewalMonths] = useState(String(initial?.renewalMonths ?? 12));
  const [dueDay, setDueDay] = useState(String(initial?.dueDay ?? 10));
  const [monthlyFee, setMonthlyFee] = useState(initial ? centsToInput(initial.monthlyFeeCents) : '');
  const [deliveryFee, setDeliveryFee] = useState(initial ? centsToInput(initial.perDeliveryFeeCents) : '');
  const [discount, setDiscount] = useState(initial ? String(initial.discountBp / 100).replace('.', ',') : '0');
  const [prorate, setProrate] = useState(initial?.prorateFirstMonth ?? true);
  const [customTerms, setCustomTerms] = useState(initial?.customTerms ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [reason, setReason] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [items, setItems] = useState<ItemDraft[]>(
    () =>
      initial?.items.map((i) => ({
        key: crypto.randomUUID(),
        productId: i.productId,
        contracted: String(i.contractedQuantity),
        franchise: String(i.franchiseQuantity),
        unit: centsToInput(i.unitPriceCents),
        excess: centsToInput(i.excessPriceCents),
        loss: i.lossPriceCents === null ? '' : centsToInput(i.lossPriceCents),
        damage: i.damagePriceCents === null ? '' : centsToInput(i.damagePriceCents),
      })) ?? [],
  );
  const products = useQuery({ queryKey: ['products', 'active'], queryFn: ({ signal }) => apiFetch<{ id: string; name: string }[]>('/api/admin/products', { signal }) });
  const showFee = billingType === 'MONTHLY_FIXED' || billingType === 'HYBRID' || billingType === 'CUSTOM';
  const showDelivery = billingType === 'PER_DELIVERY';
  const showUnit = billingType === 'PER_QUANTITY';
  const showFranchise = billingType === 'HYBRID' || billingType === 'CUSTOM';
  const upd = (key: string, patch: Partial<ItemDraft>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  function submit() {
    setLocalError(null);
    const money = (v: string, label: string, optional = false): number | null => {
      if (optional && v.trim() === '') return null;
      const c = parseBRLToCents(v.trim() === '' ? '0' : v);
      if (c === null) throw new Error(`${label}: valor inválido (ex.: 15,90).`);
      return c;
    };
    try {
      const disc = Number(discount.replace(',', '.'));
      if (!Number.isFinite(disc) || disc < 0 || disc > 100) throw new Error('Desconto deve estar entre 0 e 100%.');
      if (withCustomer && !customer) throw new Error('Escolha o cliente.');
      onSubmit({
        ...(withCustomer ? { customerId: customer!.id } : {}),
        ...(requireReason ? { reason } : {}),
        billingType,
        startsOn,
        endsOn: endsOn || null,
        renewal,
        renewalMonths: intOf(renewalMonths) || 12,
        dueDay: Math.min(28, Math.max(1, intOf(dueDay))),
        monthlyFeeCents: showFee ? money(monthlyFee, 'Mensalidade')! : 0,
        perDeliveryFeeCents: showDelivery ? money(deliveryFee, 'Valor por entrega')! : 0,
        discountBp: Math.round(disc * 100),
        prorateFirstMonth: prorate,
        customTerms: customTerms || null,
        notes: notes || null,
        items: items
          .filter((i) => i.productId)
          .map((i) => ({
            productId: i.productId,
            contractedQuantity: intOf(i.contracted),
            franchiseQuantity: showFranchise ? intOf(i.franchise) : 0,
            unitPriceCents: showUnit ? money(i.unit, 'Preço por peça')! : 0,
            excessPriceCents: showFranchise ? money(i.excess, 'Preço do excedente')! : 0,
            lossPriceCents: money(i.loss, 'Preço de perda', true),
            damagePriceCents: money(i.damage, 'Preço de dano', true),
          })),
      });
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Dados inválidos.');
    }
  }

  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      {withCustomer && (
        <div className="space-y-1.5">
          <Label htmlFor="customer-search">
            Cliente <span className="text-destructive">*</span>
          </Label>
          <CustomerPicker value={customer} onChange={setCustomer} allowInactive />
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="c-type" label="Tipo de cobrança" required className="space-y-1.5 sm:col-span-3">
          <Select id="c-type" value={billingType} onChange={(e) => setBillingType(e.target.value)}>
            {Object.entries(BILLING_TYPE_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="c-start" label="Início" required>
          <Input id="c-start" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
        </Field>
        <Field id="c-end" label="Fim" hint="Vazio = prazo indeterminado">
          <Input id="c-end" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
        </Field>
        <Field id="c-due" label="Dia de vencimento" required hint="1 a 28">
          <Input id="c-due" type="number" min={1} max={28} value={dueDay} onChange={(e) => setDueDay(e.target.value)} />
        </Field>
        <Field id="c-renewal" label="Renovação">
          <Select id="c-renewal" value={renewal} onChange={(e) => setRenewal(e.target.value)}>
            {Object.entries(RENEWAL_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        {renewal === 'AUTO' && (
          <Field id="c-renew-m" label="Renovar por (meses)">
            <Input id="c-renew-m" type="number" min={1} max={60} value={renewalMonths} onChange={(e) => setRenewalMonths(e.target.value)} />
          </Field>
        )}
        {showFee && (
          <Field id="c-fee" label="Mensalidade (R$)" required={billingType !== 'CUSTOM'}>
            <Input id="c-fee" inputMode="decimal" placeholder="0,00" value={monthlyFee} onChange={(e) => setMonthlyFee(e.target.value)} />
          </Field>
        )}
        {showDelivery && (
          <Field id="c-deliv" label="Valor por entrega (R$)" required>
            <Input id="c-deliv" inputMode="decimal" placeholder="0,00" value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} />
          </Field>
        )}
        <Field id="c-disc" label="Desconto (%)">
          <Input id="c-disc" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} />
        </Field>
      </div>
      {showFee && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={prorate} onChange={(e) => setProrate(e.target.checked)} />
          Cobrar mensalidade proporcional quando a vigência começa ou termina no meio do mês
        </label>
      )}

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">Produtos do contrato</legend>
        <p className="text-xs text-muted-foreground">Preço de perda/dano em branco = usa o preço de reposição do produto.</p>
        {items.map((i) => (
          <div key={i.key} className="grid gap-2 rounded-md border p-2 sm:grid-cols-4">
            <Select aria-label="Produto" className="sm:col-span-2" value={i.productId} onChange={(e) => upd(i.key, { productId: e.target.value })}>
              <option value="">Produto…</option>
              {products.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <Input aria-label="Quantidade contratada" placeholder="Qtd. contratada" inputMode="numeric" value={i.contracted} onChange={(e) => upd(i.key, { contracted: e.target.value })} />
            <Button type="button" variant="ghost" size="icon" aria-label="Remover produto" onClick={() => setItems((l) => l.filter((x) => x.key !== i.key))}>
              <Trash2 aria-hidden />
            </Button>
            {showFranchise && (
              <>
                <Input aria-label="Franquia mensal" placeholder="Franquia/mês" inputMode="numeric" value={i.franchise} onChange={(e) => upd(i.key, { franchise: e.target.value })} />
                <Input aria-label="Preço do excedente" placeholder="Excedente R$/peça" inputMode="decimal" value={i.excess} onChange={(e) => upd(i.key, { excess: e.target.value })} />
              </>
            )}
            {showUnit && <Input aria-label="Preço por peça" placeholder="R$ por peça" inputMode="decimal" value={i.unit} onChange={(e) => upd(i.key, { unit: e.target.value })} />}
            <Input aria-label="Preço de perda" placeholder="Perda R$/peça" inputMode="decimal" value={i.loss} onChange={(e) => upd(i.key, { loss: e.target.value })} />
            <Input aria-label="Preço de dano" placeholder="Dano R$/peça" inputMode="decimal" value={i.damage} onChange={(e) => upd(i.key, { damage: e.target.value })} />
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setItems((l) => [...l, { key: crypto.randomUUID(), productId: '', contracted: '0', franchise: '0', unit: '', excess: '', loss: '', damage: '' }])}
        >
          <Plus aria-hidden /> Adicionar produto
        </Button>
      </fieldset>

      {billingType === 'CUSTOM' && (
        <Field id="c-custom" label="Condições personalizadas" hint="Lançamentos deste contrato são feitos manualmente no financeiro.">
          <Textarea id="c-custom" maxLength={4000} value={customTerms} onChange={(e) => setCustomTerms(e.target.value)} />
        </Field>
      )}
      <Field id="c-notes" label="Notas internas">
        <Textarea id="c-notes" maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      {requireReason && (
        <Field id="c-reason" label="Motivo da alteração" required hint="Contrato vigente: fica na revisão e na auditoria.">
          <Input id="c-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      )}
      {(localError || error) && <Alert variant="destructive">{localError ?? error}</Alert>}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || (requireReason && reason.trim().length < 5)}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
