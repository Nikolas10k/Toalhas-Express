'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/page-header';
import { DRIVER_STATUS_LABEL } from '@/components/routes/labels';
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
import { formatDocument } from '@/lib/br/documents';
import { formatPhone } from '@/lib/br/phone';
import { formatPlate } from '@/lib/br/plate';
import type { Vehicle } from '../veiculos/vehicles-manager';

export interface Driver {
  id: string;
  fullName: string;
  document: string | null;
  phone: string | null;
  userId: string | null;
  userName: string | null;
  defaultVehicleId: string | null;
  defaultVehiclePlate: string | null;
  status: string;
  notes: string | null;
}

export function DriversManager({ canManage, canLinkUsers }: { canManage: boolean; canLinkUsers: boolean }) {
  const [editing, setEditing] = useState<Driver | 'new' | null>(null);
  const q = useQuery({ queryKey: ['drivers'], queryFn: ({ signal }) => apiFetch<Driver[]>('/api/admin/drivers', { signal }) });

  return (
    <>
      <PageHeader
        title="Motoristas"
        description="O motorista acessa o app com o próprio usuário (perfil Motorista) e vê só as rotas dele — nada financeiro."
      >
        {canManage && (
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden /> Novo motorista
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
          <p className="py-10 text-center text-muted-foreground">Nenhum motorista cadastrado.</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Nome</TH>
                <TH>CPF</TH>
                <TH>Telefone</TH>
                <TH>Acesso ao app</TH>
                <TH>Veículo padrão</TH>
                <TH>Status</TH>
                <TH>
                  <span className="sr-only">Ações</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {q.data?.map((d) => (
                <TR key={d.id}>
                  <TD className="font-medium">{d.fullName}</TD>
                  <TD className="whitespace-nowrap">{formatDocument(d.document) || '—'}</TD>
                  <TD className="whitespace-nowrap">{d.phone ? formatPhone(d.phone) : '—'}</TD>
                  <TD>{d.userId ? d.userName ?? 'Vinculado' : <span className="text-muted-foreground">Sem usuário</span>}</TD>
                  <TD className="font-mono">{d.defaultVehiclePlate ? formatPlate(d.defaultVehiclePlate) : '—'}</TD>
                  <TD>
                    <Badge variant={d.status === 'ACTIVE' ? 'success' : d.status === 'ON_LEAVE' ? 'warning' : 'secondary'}>{DRIVER_STATUS_LABEL[d.status]}</Badge>
                  </TD>
                  <TD className="text-right">
                    {canManage && (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(d)}>
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
      {editing && <DriverDialog driver={editing === 'new' ? null : editing} canLinkUsers={canLinkUsers} onClose={() => setEditing(null)} />}
    </>
  );
}

function DriverDialog({ driver, canLinkUsers, onClose }: { driver: Driver | null; canLinkUsers: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [fullName, setFullName] = useState(driver?.fullName ?? '');
  const [document, setDocument] = useState(formatDocument(driver?.document ?? null));
  const [phone, setPhone] = useState(driver?.phone ? formatPhone(driver.phone) : '');
  const [userId, setUserId] = useState(driver?.userId ?? '');
  const [vehicleId, setVehicleId] = useState(driver?.defaultVehicleId ?? '');
  const [status, setStatus] = useState(driver?.status ?? 'ACTIVE');
  const [notes, setNotes] = useState(driver?.notes ?? '');
  const vehicles = useQuery({ queryKey: ['vehicles'], queryFn: ({ signal }) => apiFetch<Vehicle[]>('/api/admin/vehicles', { signal }) });
  const candidates = useQuery({
    queryKey: ['driver-candidates'],
    enabled: canLinkUsers,
    queryFn: ({ signal }) => apiFetch<{ userId: string; fullName: string | null }[]>('/api/admin/drivers/candidates', { signal }),
  });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        fullName,
        document: document || null,
        phone: phone || null,
        defaultVehicleId: vehicleId || null,
        status,
        notes: notes || null,
        ...(canLinkUsers ? { userId: userId || null } : {}),
      };
      return driver ? apiFetch(`/api/admin/drivers/${driver.id}`, { method: 'PATCH', body }) : apiFetch('/api/admin/drivers', { body });
    },
    onSuccess: () => {
      toast.success('Motorista salvo.');
      qc.invalidateQueries({ queryKey: ['drivers'] });
      qc.invalidateQueries({ queryKey: ['driver-candidates'] });
      onClose();
    },
  });
  const userOptions = [
    ...(driver?.userId ? [{ userId: driver.userId, fullName: driver.userName }] : []),
    ...(candidates.data ?? []),
  ];

  return (
    <Dialog open onClose={onClose} title={driver ? 'Editar motorista' : 'Novo motorista'}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field id="d-name" label="Nome completo" required>
          <Input id="d-name" value={fullName} maxLength={150} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="d-doc" label="CPF">
            <Input id="d-doc" inputMode="numeric" value={document} maxLength={14} onChange={(e) => setDocument(e.target.value)} />
          </Field>
          <Field id="d-phone" label="Telefone">
            <Input id="d-phone" inputMode="tel" value={phone} maxLength={20} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field id="d-vehicle" label="Veículo padrão">
            <Select id="d-vehicle" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">Nenhum</option>
              {vehicles.data?.map((v) => (
                <option key={v.id} value={v.id}>
                  {formatPlate(v.plate)} · {v.model}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="d-status" label="Status">
            <Select id="d-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              {Object.entries(DRIVER_STATUS_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {canLinkUsers && (
          <Field
            id="d-user"
            label="Usuário do app"
            hint="Convide a pessoa em Administração → Usuários com o perfil Motorista; depois vincule aqui."
          >
            <Select id="d-user" value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Sem acesso ao app</option>
              {userOptions.map((u) => (
                <option key={u.userId} value={u.userId}>
                  {u.fullName ?? 'Usuário sem nome'}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field id="d-notes" label="Observações">
          <Textarea id="d-notes" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {save.error && <Alert variant="destructive">{describeApiError(save.error)}</Alert>}
        <div className="flex justify-end">
          <Button type="submit" disabled={save.isPending || fullName.trim().length < 2}>
            Salvar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
