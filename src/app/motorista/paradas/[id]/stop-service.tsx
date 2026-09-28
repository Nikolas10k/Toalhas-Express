'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ORDER_TYPE_LABEL } from '@/components/orders/labels';
import { currentPosition } from '@/components/operations/geo';
import { DAMAGE_CLASS_LABEL } from '@/components/operations/labels';
import { PhotoPicker, type PickedPhoto } from '@/components/operations/photo-picker';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch, describeApiError } from '@/lib/api-client';

interface Line {
  productId: string;
  name: string;
  plannedDelivery: number;
  loaded: number;
  expectedCollection: number;
  customerBalance: number;
}

interface Form {
  stop: { id: string; status: string; sequence: number };
  route: { id: string; status: string };
  order: { id: string; number: string; type: string; status: string; customerName: string | null; notes: string | null };
  lines: Line[];
  requireProofPhoto: boolean;
  canOperate: boolean;
}

interface Entry {
  delivered: string;
  collected: string;
  damaged: string;
  damageClass: string;
}

const num = (v: string) => Math.max(0, Math.trunc(Number(v) || 0));

export function StopService({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [recipient, setRecipient] = useState('');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const q = useQuery({
    queryKey: ['stop-service', id],
    queryFn: ({ signal }) => apiFetch<Form>(`/api/driver/stops/${id}/service`, { signal }),
  });
  const entry = (l: Line): Entry =>
    entries[l.productId] ?? { delivered: String(Math.min(l.plannedDelivery, l.loaded)), collected: String(l.expectedCollection), damaged: '0', damageClass: '' };
  const set = (l: Line, patch: Partial<Entry>) => setEntries((e) => ({ ...e, [l.productId]: { ...entry(l), ...patch } }));

  const submit = useMutation({
    mutationFn: async () =>
      apiFetch<{ incidents: string[] }>(`/api/driver/stops/${id}/complete`, {
        body: {
          items: q.data!.lines.map((l) => {
            const e = entry(l);
            return { productId: l.productId, delivered: num(e.delivered), collected: num(e.collected), damaged: num(e.damaged), damageClass: e.damageClass || null };
          }),
          recipientName: recipient || null,
          notes: notes || null,
          attachmentIds: photos.map((p) => p.id),
          geo: await currentPosition(),
        },
      }),
    onSuccess: (r) => {
      toast.success(r.incidents.length ? `Atendimento registrado com ${r.incidents.length} ocorrência(s) para a equipe.` : 'Atendimento registrado.');
      qc.invalidateQueries({ queryKey: ['driver-route'] });
      router.push(`/motorista/rotas/${q.data!.route.id}`);
    },
  });

  if (q.isPending) return <Skeleton className="h-96 w-full" />;
  if (q.error) return <Alert variant="destructive">{describeApiError(q.error)}</Alert>;
  const { order, lines } = q.data;
  const showDelivery = order.type !== 'COLLECTION';
  const showCollection = order.type !== 'DELIVERY' || lines.some((l) => l.customerBalance > 0);
  const warnings = lines.flatMap((l) => {
    const e = entry(l);
    const out: string[] = [];
    if (num(e.collected) < l.expectedCollection) out.push(`${l.name}: ${l.expectedCollection - num(e.collected)} ficarão com o cliente`);
    if (num(e.collected) > l.expectedCollection) out.push(`${l.name}: coletando ${num(e.collected) - l.expectedCollection} a mais que o esperado`);
    if (num(e.delivered) < l.plannedDelivery) out.push(`${l.name}: ${l.plannedDelivery - num(e.delivered)} voltarão com você`);
    if (num(e.damaged) > 0) out.push(`${l.name}: ${num(e.damaged)} com dano`);
    return out;
  });
  const moved = lines.some((l) => num(entry(l).delivered) > 0 || num(entry(l).collected) > 0);
  const invalid = lines.some((l) => {
    const e = entry(l);
    return num(e.delivered) > l.loaded || num(e.collected) > l.customerBalance || num(e.damaged) > num(e.collected) || (num(e.damaged) > 0 && !e.damageClass);
  });
  const missingProof = moved && (recipient.trim().length < 2 || (q.data.requireProofPhoto && photos.length === 0));

  return (
    <div className="space-y-4">
      <Link href={`/motorista/rotas/${q.data.route.id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Voltar à rota
      </Link>
      <div>
        <h1 className="text-xl font-semibold">{order.customerName ?? 'Cliente'}</h1>
        <p className="text-sm text-muted-foreground">
          Parada {q.data.stop.sequence} · {order.number} · {ORDER_TYPE_LABEL[order.type]}
        </p>
        {order.notes && <p className="mt-2 rounded bg-muted p-2 text-sm">{order.notes}</p>}
      </div>
      {!q.data.canOperate && <Alert>Esta parada não está em atendimento (rota não iniciada ou parada já concluída).</Alert>}

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit.mutate();
        }}
      >
        {lines.map((l) => {
          const e = entry(l);
          return (
            <Card key={l.productId}>
              <CardContent className="space-y-3 p-4">
                <p className="font-medium">{l.name}</p>
                {showDelivery && (l.plannedDelivery > 0 || l.loaded > 0) && (
                  <Field id={`d-${l.productId}`} label={`Entregues (previsto ${l.plannedDelivery}, no veículo ${l.loaded})`}>
                    <Input id={`d-${l.productId}`} type="number" inputMode="numeric" min={0} max={l.loaded} className="h-12 text-lg" value={e.delivered} onChange={(ev) => set(l, { delivered: ev.target.value })} />
                  </Field>
                )}
                {showCollection && (l.customerBalance > 0 || l.expectedCollection > 0) && (
                  <>
                    <Field id={`c-${l.productId}`} label={`Coletadas (esperado ${l.expectedCollection}, cliente tem ${l.customerBalance})`}>
                      <Input id={`c-${l.productId}`} type="number" inputMode="numeric" min={0} max={l.customerBalance} className="h-12 text-lg" value={e.collected} onChange={(ev) => set(l, { collected: ev.target.value })} />
                    </Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Field id={`x-${l.productId}`} label="Com dano (das coletadas)">
                        <Input id={`x-${l.productId}`} type="number" inputMode="numeric" min={0} className="h-12" value={e.damaged} onChange={(ev) => set(l, { damaged: ev.target.value })} />
                      </Field>
                      {num(e.damaged) > 0 && (
                        <Field id={`k-${l.productId}`} label="Tipo de dano">
                          <Select id={`k-${l.productId}`} className="h-12" value={e.damageClass} onChange={(ev) => set(l, { damageClass: ev.target.value })}>
                            <option value="">Selecione…</option>
                            {Object.entries(DAMAGE_CLASS_LABEL).map(([k, v]) => (
                              <option key={k} value={k}>
                                {v}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}

        {warnings.length > 0 && (
          <Alert>
            <p className="flex items-center gap-1 font-medium">
              <AlertTriangle className="size-4" aria-hidden /> Será aberta ocorrência para a equipe:
            </p>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </Alert>
        )}

        <Field id="recipient" label="Nome de quem recebeu" required={moved}>
          <Input id="recipient" className="h-12" autoComplete="off" maxLength={150} value={recipient} onChange={(e) => setRecipient(e.target.value)} />
        </Field>
        <div className="space-y-1.5">
          <p className="text-sm font-medium">
            Foto do comprovante {q.data.requireProofPhoto ? <span className="text-destructive">*</span> : <span className="text-muted-foreground">(opcional)</span>}
          </p>
          <PhotoPicker photos={photos} onChange={setPhotos} />
        </div>
        <Field id="notes" label="Observações">
          <Textarea id="notes" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {submit.error && <Alert variant="destructive">{describeApiError(submit.error)}</Alert>}
        <Button type="submit" className="h-14 w-full text-base" disabled={!q.data.canOperate || invalid || missingProof || submit.isPending}>
          <CheckCircle2 aria-hidden /> {submit.isPending ? 'Registrando…' : 'Concluir atendimento'}
        </Button>
      </form>
    </div>
  );
}
