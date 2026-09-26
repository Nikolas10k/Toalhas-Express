'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch, describeApiError } from '@/lib/api-client';
import { formatCents } from '@/lib/money-format';
import { MANUAL_MOVES, STATE_LABEL, STATE_ORDER } from './labels';

type Kind = 'entry' | 'adjust' | 'TRANSFER' | 'DAMAGE' | 'LOSS' | 'DISCARD';

const KIND_LABEL: Record<Kind, string> = {
  entry: 'Entrada de estoque (compra/reposição)',
  adjust: 'Ajuste de saldo (contagem física)',
  TRANSFER: 'Transferência entre estados',
  DAMAGE: 'Registrar dano',
  LOSS: 'Registrar perda',
  DISCARD: 'Descartar',
};

interface Preview {
  productName: string;
  from: { state: string; before: number; after: number } | null;
  to: { state: string; before: number; after: number } | null;
  customerName: string | null;
  replacementValueCents: number | null;
  requiresStepUp: boolean;
  blocked: string | null;
}

export interface OperationDefaults {
  kind?: Kind;
  productId?: string;
  customerId?: string;
  customerName?: string;
  state?: string;
}

/**
 * Operação manual de estoque em duas etapas: preencher → ver impacto
 * (saldos antes/depois e valor de reposição) → confirmar.
 */
export function StockOperationDialog({
  open,
  onClose,
  defaults,
  allowedKinds,
}: {
  open: boolean;
  onClose: () => void;
  defaults?: OperationDefaults;
  allowedKinds: Kind[];
}) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<Kind>(defaults?.kind ?? allowedKinds[0]!);
  const [productId, setProductId] = useState(defaults?.productId ?? '');
  const [qty, setQty] = useState('');
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [state, setState] = useState(defaults?.state ?? 'AVAILABLE');
  const [edge, setEdge] = useState(0);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());
  const customerId = defaults?.customerId;

  const products = useQuery({
    queryKey: ['products', 'active'],
    queryFn: ({ signal }) => apiFetch<{ id: string; name: string; sku: string }[]>('/api/admin/products', { signal }),
    enabled: open,
  });

  const quantity = Number(qty);
  const edges: [string, string][] = kind in MANUAL_MOVES ? MANUAL_MOVES[kind as keyof typeof MANUAL_MOVES] : [];
  const [from, to] = edges[edge] ?? ['', ''];
  const needsCustomer = (kind === 'adjust' && state === 'WITH_CUSTOMER') || from === 'WITH_CUSTOMER';

  const body = () => {
    if (kind === 'entry') return { kind: 'entry', productId, quantity, reason };
    if (kind === 'adjust')
      return { kind: 'adjust', productId, state, delta: direction === 'in' ? quantity : -quantity, customerId: state === 'WITH_CUSTOMER' ? customerId : null, reason };
    return { kind: 'move', type: kind, productId, from, to, quantity, customerId: needsCustomer ? customerId : null, reason };
  };

  const previewM = useMutation({
    mutationFn: () => apiFetch<Preview>('/api/admin/inventory/operations/preview', { body: body() }),
    onSuccess: setPreview,
  });
  const execute = useMutation({
    mutationFn: () => apiFetch('/api/admin/inventory/operations', { body: body(), idempotencyKey: idemKey }),
    onSuccess: () => {
      toast.success('Movimento registrado.');
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['customer-balances'] });
      reset();
      onClose();
    },
  });

  function reset() {
    setQty('');
    setReason('');
    setPreview(null);
    setIdemKey(crypto.randomUUID());
  }

  const valid = productId && Number.isInteger(quantity) && quantity > 0 && reason.trim().length >= 5 && (!needsCustomer || customerId);

  return (
    <Dialog open={open} onClose={() => { reset(); onClose(); }} title="Movimentar estoque" description={defaults?.customerName ? `Cliente: ${defaults.customerName}` : undefined}>
      {!preview ? (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); previewM.mutate(); }}>
          <Field id="op-kind" label="Operação">
            <Select id="op-kind" value={kind} onChange={(e) => { setKind(e.target.value as Kind); setEdge(0); }}>
              {allowedKinds.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="op-product" label="Produto" required>
            <Select id="op-product" value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">Selecione…</option>
              {products.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.sku})
                </option>
              ))}
            </Select>
          </Field>
          {kind === 'adjust' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="op-state" label="Estado">
                <Select id="op-state" value={state} onChange={(e) => setState(e.target.value)} disabled={Boolean(defaults?.state)}>
                  {STATE_ORDER.filter((s) => s !== 'WITH_CUSTOMER' || customerId).map((s) => (
                    <option key={s} value={s}>
                      {STATE_LABEL[s]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="op-dir" label="Tipo de ajuste">
                <Select id="op-dir" value={direction} onChange={(e) => setDirection(e.target.value as 'in' | 'out')}>
                  <option value="in">Aumentar</option>
                  <option value="out">Diminuir</option>
                </Select>
              </Field>
            </div>
          )}
          {edges.length > 0 && (
            <Field id="op-edge" label="De → para">
              <Select id="op-edge" value={edge} onChange={(e) => setEdge(Number(e.target.value))}>
                {edges.map(([f, t], i) =>
                  (f === 'WITH_CUSTOMER' || t === 'WITH_CUSTOMER') && !customerId ? null : (
                    <option key={`${f}-${t}`} value={i}>
                      {STATE_LABEL[f]} → {STATE_LABEL[t]}
                    </option>
                  ),
                )}
              </Select>
            </Field>
          )}
          <Field id="op-qty" label="Quantidade" required>
            <Input id="op-qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field id="op-reason" label="Motivo" required hint="Fica registrado no movimento e na auditoria.">
            <Textarea id="op-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {previewM.error && <Alert variant="destructive">{describeApiError(previewM.error)}</Alert>}
          <div className="flex justify-end">
            <Button type="submit" disabled={!valid || previewM.isPending}>
              Ver impacto
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          <p className="text-sm">
            <strong>{quantity}</strong> × {preview.productName}
            {preview.customerName && <> · cliente <strong>{preview.customerName}</strong></>}
          </p>
          <div className="grid gap-2 text-sm sm:grid-cols-[1fr_auto_1fr] sm:items-center">
            <Balance label={preview.from ? STATE_LABEL[preview.from.state] : 'Fora do sistema'} b={preview.from} />
            <ArrowRight className="mx-auto size-4 text-muted-foreground" aria-hidden />
            <Balance label={preview.to ? STATE_LABEL[preview.to.state] : 'Fora do sistema'} b={preview.to} />
          </div>
          {preview.replacementValueCents !== null && (
            <Alert>
              Valor de reposição envolvido: <strong>{formatCents(preview.replacementValueCents)}</strong>. A cobrança do cliente, quando
              aplicável, é feita pelo fluxo de ocorrências (Fase 6).
            </Alert>
          )}
          {preview.requiresStepUp && <Alert>Ajuste grande: será pedido o código do autenticador.</Alert>}
          {preview.blocked && (
            <Alert variant="destructive">
              <AlertTriangle className="mr-1 inline size-4" aria-hidden /> {preview.blocked}
            </Alert>
          )}
          {execute.error && <Alert variant="destructive">{describeApiError(execute.error)}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPreview(null)}>
              Voltar
            </Button>
            <Button onClick={() => execute.mutate()} disabled={Boolean(preview.blocked) || execute.isPending}>
              Confirmar
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function Balance({ label, b }: { label: string | undefined; b: { before: number; after: number } | null }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      {b ? (
        <p className="font-medium">
          {b.before} → <span className={b.after < 0 ? 'text-destructive' : ''}>{b.after}</span>
        </p>
      ) : (
        <p className="text-muted-foreground">—</p>
      )}
    </div>
  );
}
