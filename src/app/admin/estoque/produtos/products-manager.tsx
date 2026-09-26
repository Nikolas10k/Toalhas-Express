'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { apiFetch, describeApiError } from '@/lib/api-client';
import { centsToInput, formatCents, parseBRLToCents } from '@/lib/money-format';

interface Product {
  id: string;
  sku: string;
  name: string;
  size: string | null;
  category: string | null;
  costCents: number;
  replacementPriceCents: number;
  minStock: number;
  active: boolean;
}

interface FormState {
  sku: string;
  name: string;
  size: string;
  category: string;
  cost: string;
  replacement: string;
  minStock: string;
  active: boolean;
}

const EMPTY: FormState = { sku: '', name: '', size: '', category: '', cost: '', replacement: '', minStock: '0', active: true };

export function ProductsManager({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [formError, setFormError] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['inventory', 'products', 'all'],
    queryFn: ({ signal }) => apiFetch<Product[]>('/api/admin/products?includeInactive=true', { signal }),
  });

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editing === 'new'
        ? apiFetch('/api/admin/products', { body })
        : apiFetch(`/api/admin/products/${(editing as Product).id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      toast.success('Produto salvo.');
      setEditing(null);
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['products'] });
    },
  });

  function open(p: Product | 'new') {
    setFormError(null);
    setEditing(p);
    setForm(
      p === 'new'
        ? EMPTY
        : {
            sku: p.sku,
            name: p.name,
            size: p.size ?? '',
            category: p.category ?? '',
            cost: centsToInput(p.costCents),
            replacement: centsToInput(p.replacementPriceCents),
            minStock: String(p.minStock),
            active: p.active,
          },
    );
  }

  function submit() {
    const costCents = parseBRLToCents(form.cost || '0');
    const replacementPriceCents = parseBRLToCents(form.replacement || '0');
    const minStock = Number(form.minStock);
    if (costCents === null || replacementPriceCents === null) return setFormError('Valores em reais inválidos. Ex.: 15,90');
    if (!Number.isInteger(minStock) || minStock < 0) return setFormError('Estoque mínimo inválido.');
    setFormError(null);
    save.mutate({
      sku: form.sku,
      name: form.name,
      size: form.size || null,
      category: form.category || null,
      costCents,
      replacementPriceCents,
      minStock,
      active: form.active,
    });
  }

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <>
      <Link href="/admin/estoque" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Estoque
      </Link>
      <PageHeader title="Produtos" description="Tipos de toalha controlados no estoque.">
        {canManage && (
          <Button onClick={() => open('new')}>
            <Plus aria-hidden /> Novo produto
          </Button>
        )}
      </PageHeader>
      {q.error && <Alert variant="destructive">{describeApiError(q.error)}</Alert>}
      <Card>
        <Table>
          <THead>
            <TR>
              <TH>SKU</TH>
              <TH>Nome</TH>
              <TH>Tamanho</TH>
              <TH>Categoria</TH>
              <TH className="text-right">Custo</TH>
              <TH className="text-right">Reposição</TH>
              <TH className="text-right">Mínimo</TH>
              <TH>Situação</TH>
              <TH>
                <span className="sr-only">Ações</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {q.isPending && (
              <TR>
                <TD colSpan={9}>
                  <Skeleton className="h-6 w-full" />
                </TD>
              </TR>
            )}
            {q.data?.length === 0 && (
              <TR>
                <TD colSpan={9} className="py-10 text-center text-muted-foreground">
                  Nenhum produto cadastrado.
                </TD>
              </TR>
            )}
            {q.data?.map((p) => (
              <TR key={p.id}>
                <TD className="font-mono text-xs">{p.sku}</TD>
                <TD className="font-medium">{p.name}</TD>
                <TD>{p.size ?? '—'}</TD>
                <TD>{p.category ?? '—'}</TD>
                <TD className="text-right tabular-nums">{formatCents(p.costCents)}</TD>
                <TD className="text-right tabular-nums">{formatCents(p.replacementPriceCents)}</TD>
                <TD className="text-right tabular-nums">{p.minStock}</TD>
                <TD>{p.active ? <Badge variant="success">Ativo</Badge> : <Badge variant="secondary">Inativo</Badge>}</TD>
                <TD className="text-right">
                  {canManage && (
                    <Button size="sm" variant="ghost" onClick={() => open(p)}>
                      Editar
                    </Button>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>

      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Novo produto' : 'Editar produto'}>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="p-sku" label="SKU" required hint="Ex.: TOA-BANHO-70">
              <Input id="p-sku" value={form.sku} onChange={set('sku')} />
            </Field>
            <Field id="p-name" label="Nome" required>
              <Input id="p-name" value={form.name} onChange={set('name')} />
            </Field>
            <Field id="p-size" label="Tamanho">
              <Input id="p-size" value={form.size} onChange={set('size')} placeholder="70x140 cm" />
            </Field>
            <Field id="p-cat" label="Categoria">
              <Input id="p-cat" value={form.category} onChange={set('category')} placeholder="Banho, Rosto, Maca…" />
            </Field>
            <Field id="p-cost" label="Custo (R$)">
              <Input id="p-cost" inputMode="decimal" value={form.cost} onChange={set('cost')} placeholder="0,00" />
            </Field>
            <Field id="p-repl" label="Preço de reposição (R$)" hint="Cobrado em perdas/danos.">
              <Input id="p-repl" inputMode="decimal" value={form.replacement} onChange={set('replacement')} placeholder="0,00" />
            </Field>
            <Field id="p-min" label="Estoque mínimo (disponível)">
              <Input id="p-min" inputMode="numeric" value={form.minStock} onChange={set('minStock')} />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" className="size-4" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Ativo
            </label>
          </div>
          {(formError || save.error) && <Alert variant="destructive">{formError ?? describeApiError(save.error)}</Alert>}
          <div className="flex justify-end">
            <Button type="submit" disabled={save.isPending}>
              Salvar
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
