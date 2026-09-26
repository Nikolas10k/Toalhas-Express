'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/page-header';
import { VEHICLE_STATUS_LABEL } from '@/components/routes/labels';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch, describeApiError } from '@/lib/api-client';
import { formatPlate } from '@/lib/br/plate';

export interface Vehicle {
  id: string;
  plate: string;
  model: string;
  capacity: number;
  status: string;
  notes: string | null;
}

export function VehiclesManager({ canManage }: { canManage: boolean }) {
  const [editing, setEditing] = useState<Vehicle | 'new' | null>(null);
  const q = useQuery({ queryKey: ['vehicles'], queryFn: ({ signal }) => apiFetch<Vehicle[]>('/api/admin/vehicles', { signal }) });

  return (
    <>
      <PageHeader title="Veículos" description="Capacidade em toalhas por viagem: o planejamento não deixa passar do limite.">
        {canManage && (
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden /> Novo veículo
          </Button>
        )}
      </PageHeader>
      {q.error && <Alert variant="destructive">{describeApiError(q.error)}</Alert>}
      <Card>
        {q.isPending ? (
          <div className="p-4">
            <Skeleton className="h-6 w-full" />
          </div>
        ) : q.data?.length === 0 ? (
          <p className="py-10 text-center text-muted-foreground">Nenhum veículo cadastrado.</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Placa</TH>
                <TH>Modelo</TH>
                <TH className="text-right">Capacidade</TH>
                <TH>Status</TH>
                <TH>
                  <span className="sr-only">Ações</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {q.data?.map((v) => (
                <TR key={v.id}>
                  <TD className="font-mono font-medium">{formatPlate(v.plate)}</TD>
                  <TD>{v.model}</TD>
                  <TD className="text-right tabular-nums">{v.capacity} toalhas</TD>
                  <TD>
                    <Badge variant={v.status === 'ACTIVE' ? 'success' : 'secondary'}>{VEHICLE_STATUS_LABEL[v.status]}</Badge>
                  </TD>
                  <TD className="text-right">
                    {canManage && (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(v)}>
                        Editar
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {editing && <VehicleDialog vehicle={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function VehicleDialog({ vehicle, onClose }: { vehicle: Vehicle | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [plate, setPlate] = useState(vehicle ? formatPlate(vehicle.plate) : '');
  const [model, setModel] = useState(vehicle?.model ?? '');
  const [capacity, setCapacity] = useState(String(vehicle?.capacity ?? ''));
  const [status, setStatus] = useState(vehicle?.status ?? 'ACTIVE');
  const [notes, setNotes] = useState(vehicle?.notes ?? '');
  const save = useMutation({
    mutationFn: () => {
      const body = { plate, model, capacity: Number(capacity), status, notes: notes || null };
      return vehicle ? apiFetch(`/api/admin/vehicles/${vehicle.id}`, { method: 'PATCH', body }) : apiFetch('/api/admin/vehicles', { body });
    },
    onSuccess: () => {
      toast.success('Veículo salvo.');
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      onClose();
    },
  });
  return (
    <Dialog open onClose={onClose} title={vehicle ? 'Editar veículo' : 'Novo veículo'}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="v-plate" label="Placa" required hint="ABC-1234 ou ABC1D23">
            <Input id="v-plate" value={plate} maxLength={8} onChange={(e) => setPlate(e.target.value.toUpperCase())} />
          </Field>
          <Field id="v-model" label="Modelo" required>
            <Input id="v-model" value={model} maxLength={100} onChange={(e) => setModel(e.target.value)} />
          </Field>
          <Field id="v-cap" label="Capacidade (toalhas)" required>
            <Input id="v-cap" type="number" inputMode="numeric" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          </Field>
          <Field id="v-status" label="Status">
            <Select id="v-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              {Object.entries(VEHICLE_STATUS_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field id="v-notes" label="Observações">
          <Textarea id="v-notes" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {save.error && <Alert variant="destructive">{describeApiError(save.error)}</Alert>}
        <div className="flex justify-end">
          <Button type="submit" disabled={save.isPending || !plate || model.trim().length < 2 || !(Number(capacity) > 0)}>
            Salvar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
