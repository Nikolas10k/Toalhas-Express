'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/page-header';
import { LocationMap } from '@/components/customers/location-map';
import { formatScheduleDate, todayLocal } from '@/components/orders/labels';
import { RouteStatusBadge, ROUTE_STATUS_LABEL, formatDistance, formatDuration } from '@/components/routes/labels';
import { Alert } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { apiFetch, describeApiError } from '@/lib/api-client';
import { formatPlate } from '@/lib/br/plate';

interface RouteItem {
  id: string;
  date: string;
  driverName: string;
  vehiclePlate: string;
  vehicleCapacity: number;
  status: string;
  distanceMeters: number | null;
  durationSeconds: number | null;
  ordering: string;
  stops: number;
  openStops: number;
  totalDelivery: number;
  totalCollection: number;
}

export interface Depot {
  name: string;
  latitude: number;
  longitude: number;
}

export function RoutesList({ canManage }: { canManage: boolean }) {
  const router = useRouter();
  const [date, setDate] = useState(todayLocal());
  const [status, setStatus] = useState('');
  const [depotOpen, setDepotOpen] = useState(false);
  const q = useQuery({
    queryKey: ['routes', date, status],
    queryFn: ({ signal }) => {
      const p = new URLSearchParams();
      if (date) p.set('date', date);
      if (status) p.set('status', status);
      return apiFetch<RouteItem[]>(`/api/admin/routes?${p}`, { signal });
    },
  });
  const depot = useQuery({ queryKey: ['depot'], queryFn: ({ signal }) => apiFetch<Depot | null>('/api/admin/routes/depot', { signal }) });

  return (
    <>
      <PageHeader title="Rotas" description="Monte a rota com os pedidos prontos, defina motorista e veículo e ordene as paradas.">
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setDepotOpen(true)}>
            <MapPin aria-hidden /> Base: {depot.data?.name ?? 'não definida'}
          </Button>
          {canManage && (
            <Link href={`/admin/rotas/nova?data=${date || todayLocal()}`} className={buttonVariants()}>
              <Plus aria-hidden /> Nova rota
            </Link>
          )}
        </div>
      </PageHeader>
      <div className="mb-4 flex flex-wrap gap-3">
        <label className="flex items-center gap-2 text-sm">
          Data
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
        </label>
        <Select aria-label="Filtrar por status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-48">
          <option value="">Todos os status</option>
          {Object.entries(ROUTE_STATUS_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
      </div>
      {q.error && <Alert variant="destructive">{describeApiError(q.error)}</Alert>}
      <Card>
        {q.isPending ? (
          <div className="p-4">
            <Skeleton className="h-6 w-full" />
          </div>
        ) : q.data?.length === 0 ? (
          <p className="py-10 text-center text-muted-foreground">Nenhuma rota {date ? `em ${formatScheduleDate(date)}` : ''}.</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Data</TH>
                <TH>Motorista</TH>
                <TH>Veículo</TH>
                <TH className="text-right">Paradas</TH>
                <TH className="text-right">Entregar / coletar</TH>
                <TH>Percurso</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {q.data?.map((r) => (
                <TR key={r.id} className="cursor-pointer" onClick={() => router.push(`/admin/rotas/${r.id}`)}>
                  <TD className="whitespace-nowrap">
                    <Link href={`/admin/rotas/${r.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                      {formatScheduleDate(r.date)}
                    </Link>
                  </TD>
                  <TD>{r.driverName}</TD>
                  <TD className="font-mono">{formatPlate(r.vehiclePlate)}</TD>
                  <TD className="text-right tabular-nums">
                    {r.status === 'IN_PROGRESS' ? `${r.stops - r.openStops}/${r.stops}` : r.stops}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {r.totalDelivery} / {r.totalCollection}
                    <span className="block text-xs text-muted-foreground">cap. {r.vehicleCapacity}</span>
                  </TD>
                  <TD className="text-sm">
                    {r.ordering === 'OPTIMIZED' ? `${formatDistance(r.distanceMeters)} · ${formatDuration(r.durationSeconds)}` : 'Ordem manual'}
                  </TD>
                  <TD>
                    <RouteStatusBadge status={r.status} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {depotOpen && <DepotDialog depot={depot.data ?? null} canManage={canManage} onClose={() => setDepotOpen(false)} />}
    </>
  );
}

function DepotDialog({ depot, canManage, onClose }: { depot: Depot | null; canManage: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(depot?.name ?? '');
  const [lat, setLat] = useState<number | null>(depot?.latitude ?? null);
  const [lng, setLng] = useState<number | null>(depot?.longitude ?? null);
  const save = useMutation({
    mutationFn: () => apiFetch('/api/admin/routes/depot', { method: 'PUT', body: { name, latitude: lat, longitude: lng } }),
    onSuccess: () => {
      toast.success('Base de saída salva.');
      qc.invalidateQueries({ queryKey: ['depot'] });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Base de saída das rotas"
      description="Ponto de partida e chegada usado na otimização (ex.: lavanderia ou depósito)."
      className="max-w-2xl"
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field id="depot-name" label="Nome" required>
          <Input id="depot-name" value={name} maxLength={100} disabled={!canManage} onChange={(e) => setName(e.target.value)} />
        </Field>
        <LocationMap
          latitude={lat}
          longitude={lng}
          editable={canManage}
          onChange={(a, b) => {
            setLat(Number(a.toFixed(6)));
            setLng(Number(b.toFixed(6)));
          }}
        />
        <p className="text-xs text-muted-foreground">
          {lat !== null && lng !== null ? `Posição: ${lat}, ${lng}` : 'Clique no mapa para marcar a base.'}
        </p>
        {save.error && <Alert variant="destructive">{describeApiError(save.error)}</Alert>}
        {canManage && (
          <div className="flex justify-end">
            <Button type="submit" disabled={save.isPending || name.trim().length < 2 || lat === null || lng === null}>
              Salvar base
            </Button>
          </div>
        )}
      </form>
    </Dialog>
  );
}
