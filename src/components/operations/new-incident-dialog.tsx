'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { CustomerPicker, type PickedCustomer } from '@/components/orders/customer-picker';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch, describeApiError } from '@/lib/api-client';
import { DAMAGE_CLASS_LABEL, INCIDENT_TYPE_LABEL } from './labels';
import { PhotoPicker, type PickedPhoto } from './photo-picker';

export function NewIncidentDialog({ onClose, initialCustomer }: { onClose: () => void; initialCustomer?: PickedCustomer }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [type, setType] = useState('NOT_RETURNED');
  const [customer, setCustomer] = useState<PickedCustomer | null>(initialCustomer ?? null);
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('0');
  const [damageClass, setDamageClass] = useState('');
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const products = useQuery({
    queryKey: ['products', 'active'],
    queryFn: ({ signal }) => apiFetch<{ id: string; name: string }[]>('/api/admin/products', { signal }),
  });
  const save = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string }>('/api/admin/incidents', {
        body: {
          type,
          customerId: customer?.id ?? null,
          productId: productId || null,
          quantity: Math.max(0, Math.trunc(Number(quantity) || 0)),
          description,
          damageClass: type === 'DAMAGED' ? damageClass || null : null,
          attachmentIds: photos.map((p) => p.id),
        },
      }),
    onSuccess: (r) => {
      toast.success('Ocorrência registrada.');
      qc.invalidateQueries({ queryKey: ['incidents'] });
      router.push(`/admin/operacao/ocorrencias/${r.id}`);
    },
  });
  return (
    <Dialog open onClose={onClose} title="Nova ocorrência" className="max-w-2xl">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Field id="ni-type" label="Tipo">
          <Select id="ni-type" value={type} onChange={(e) => setType(e.target.value)}>
            {Object.entries(INCIDENT_TYPE_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <div className="space-y-1.5">
          <Label htmlFor="customer-search">Cliente</Label>
          <CustomerPicker value={customer} onChange={setCustomer} allowInactive />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="ni-product" label="Produto">
            <Select id="ni-product" value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">—</option>
              {products.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="ni-qty" label="Quantidade">
            <Input id="ni-qty" type="number" inputMode="numeric" min={0} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </Field>
        </div>
        {type === 'DAMAGED' && (
          <Field id="ni-damage" label="Tipo de dano" hint="Considera que as toalhas já estão separadas, aguardando lavagem.">
            <Select id="ni-damage" value={damageClass} onChange={(e) => setDamageClass(e.target.value)}>
              <option value="">Selecione…</option>
              {Object.entries(DAMAGE_CLASS_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field id="ni-desc" label="Descrição" required>
          <Textarea id="ni-desc" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <PhotoPicker photos={photos} onChange={setPhotos} />
        {save.error && <Alert variant="destructive">{describeApiError(save.error)}</Alert>}
        <div className="flex justify-end">
          <Button type="submit" disabled={description.trim().length < 3 || save.isPending || (Number(quantity) > 0 && !productId)}>
            Registrar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
