'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Sparkles, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { formatScheduleDate, formatWindow, ORDER_TYPE_LABEL } from '@/components/orders/labels';
import { formatDistance, formatDuration, RouteStatusBadge, STOP_STATUS_LABEL, StopStatusBadge } from '@/components/routes/labels';
import { OrderPicker } from '@/components/routes/order-picker';
import { RouteMap, type MapPoint } from '@/components/routes/route-map';
import { shortAddress, type DriverOption, type PlannableOrder, type VehicleOption } from '@/components/routes/types';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch, describeApiError } from '@/lib/api-client';
import { formatPlate } from '@/lib/br/plate';
import { formatDateTime } from '@/lib/utils';

interface Stop {
  id: string;
  sequence: number;
  status: string;
  orderId: string;
  orderNumber: string;
  orderType: string;
  customerId: string;
  customerName: string | null;
  address: Record<string, string | null>;
  latitude: number | null;
  longitude: number | null;
  windowStart: string | null;
  windowEnd: string | null;
  totalDelivery: number;
  totalCollection: number;
  statusReason: string | null;
}

interface RouteDetail {
  route: {
    id: string;
    date: string;
    status: string;
    driverId: string;
    driverName: string;
    vehicleId: string;
    vehiclePlate: string;
    vehicleModel: string;
    vehicleCapacity: number;
    distanceMeters: number | null;
    durationSeconds: number | null;
    ordering: string;
    notes: string | null;
    statusReason: string | null;
    startedAt: string | null;
    completedAt: string | null;
  };
  depot: { name: string; latitude: number; longitude: number } | null;
  straightLineMeters: number | null;
  missingLocation: number;
  totalDelivery: number;
  totalCollection: number;
  stops: Stop[];
  events: { id: string; stopId: string | null; type: string; from: string | null; to: string | null; reason: string | null; metadata: Record<string, unknown>; actorName: string | null; actorType: string; at: string }[];
  actions: { edit: boolean; cancel: boolean };
}

const EVENT_LABEL: Record<string, string> = {
  ROUTE_CREATED: 'Rota criada',
  STOP_ADDED: 'Parada adicionada',
  STOP_REMOVED: 'Parada removida',
  STOPS_REORDERED: 'Paradas reordenadas',
  ROUTE_UPDATED: 'Motorista/veículo alterado',
  ROUTE_STARTED: 'Rota iniciada',
  ROUTE_COMPLETED: 'Rota finalizada',
  ROUTE_CANCELLED: 'Rota cancelada',
  STOP_STATUS: 'Parada',
};

export function RouteDetailView({ id }: { id: string }) {
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<'add' | 'cancel' | 'edit' | null>(null);
  const q = useQuery({ queryKey: ['route', id], queryFn: ({ signal }) => apiFetch<RouteDetail>(`/api/admin/routes/${id}`, { signal }) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['route', id] });
    qc.invalidateQueries({ queryKey: ['routes'] });
    qc.invalidateQueries({ queryKey: ['plannable'] });
  };
  const reorder = useMutation({
    mutationFn: (stopIds: string[]) => apiFetch(`/api/admin/routes/${id}/reorder`, { body: { stopIds } }),
    onSuccess: refresh,
    onError: (e) => toast.error(describeApiError(e)),
  });
  const remove = useMutation({
    mutationFn: (stopId: string) => apiFetch(`/api/admin/routes/${id}/stops/${stopId}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Parada removida. O pedido voltou para "Pronto" com o estoque ainda reservado.');
      refresh();
    },
    onError: (e) => toast.error(describeApiError(e)),
  });
  const optimize = useMutation({
    mutationFn: () => apiFetch<{ distanceMeters: number; durationSeconds: number }>(`/api/admin/routes/${id}/optimize`, { body: {} }),
    onSuccess: (r) => {
      toast.success(`Ordem otimizada: ${formatDistance(r.distanceMeters)}, ${formatDuration(r.durationSeconds)}.`);
      refresh();
    },
  });

  const points: MapPoint[] = useMemo(
    () =>
      (q.data?.stops ?? [])
        .filter((s) => s.latitude !== null && s.longitude !== null)
        .map((s) => ({
          id: s.id,
          lat: s.latitude!,
          lng: s.longitude!,
          label: String(s.sequence),
          title: `${s.sequence}. ${s.customerName ?? 'Cliente'} (${s.orderNumber}) — ${STOP_STATUS_LABEL[s.status]}`,
          tone: s.status === 'COMPLETED' ? ('done' as const) : ('selected' as const),
        })),
    [q.data],
  );

  if (q.isPending) return <Skeleton className="h-96 w-full" />;
  if (q.error) return <Alert variant="destructive">{describeApiError(q.error)}</Alert>;
  const { route: r, stops, actions } = q.data;
  const move = (from: number, to: number) => {
    const ids = stops.map((s) => s.id);
    const [x] = ids.splice(from, 1);
    ids.splice(to, 0, x!);
    reorder.mutate(ids);
  };

  return (
    <>
      <Link href="/admin/rotas" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Rotas
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Rota de {formatScheduleDate(r.date)}</h1>
            <RouteStatusBadge status={r.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {r.driverName} · <span className="font-mono">{formatPlate(r.vehiclePlate)}</span> {r.vehicleModel} · carga {q.data.totalDelivery} de {r.vehicleCapacity} toalhas ·
            coletar {q.data.totalCollection}
          </p>
          {r.statusReason && <p className="mt-1 text-sm">Motivo: {r.statusReason}</p>}
          {r.startedAt && <p className="text-xs text-muted-foreground">Iniciada {formatDateTime(r.startedAt)}{r.completedAt && ` · finalizada ${formatDateTime(r.completedAt)}`}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {actions.edit && (
            <>
              <Button variant="outline" onClick={() => setDialog('add')}>
                <Plus aria-hidden /> Adicionar pedidos
              </Button>
              <Button variant="outline" onClick={() => setDialog('edit')}>
                Motorista/veículo
              </Button>
              <Button variant="outline" disabled={optimize.isPending || stops.length < 2} onClick={() => optimize.mutate()}>
                <Sparkles aria-hidden /> {optimize.isPending ? 'Otimizando…' : 'Otimizar ordem'}
              </Button>
            </>
          )}
          {actions.cancel && (
            <Button variant="outline" onClick={() => setDialog('cancel')}>
              Cancelar rota
            </Button>
          )}
        </div>
      </div>
      {optimize.error && <Alert variant="destructive" className="mb-4">{describeApiError(optimize.error)}</Alert>}
      {q.data.missingLocation > 0 && (
        <Alert className="mb-4">{q.data.missingLocation} parada(s) sem localização no mapa. Corrija o endereço no cadastro do cliente para otimizar.</Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <RouteMap
            points={points}
            depot={q.data.depot ? { lat: q.data.depot.latitude, lng: q.data.depot.longitude, name: q.data.depot.name } : null}
            className="h-[26rem] w-full overflow-hidden rounded-md border"
          />
          <p className="text-sm text-muted-foreground">
            {r.ordering === 'OPTIMIZED'
              ? `Ordem otimizada (Google): ${formatDistance(r.distanceMeters)} · ${formatDuration(r.durationSeconds)} estimados, saindo e voltando à base.`
              : `Ordem manual. Distância em linha reta: ${formatDistance(q.data.straightLineMeters)}${q.data.depot ? ' (com ida e volta à base)' : ''}.`}
          </p>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Paradas</CardTitle>
            </CardHeader>
            <ol className="divide-y">
              {stops.map((s, i) => (
                <li key={s.id} className="flex items-start gap-3 p-3 text-sm">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{s.sequence}</span>
                  <div className="flex-1">
                    <p className="font-medium">
                      <Link href={`/admin/clientes/${s.customerId}`} className="hover:underline">
                        {s.customerName ?? 'Cliente'}
                      </Link>{' '}
                      <Link href={`/admin/pedidos/${s.orderId}`} className="text-muted-foreground hover:underline">
                        · {s.orderNumber}
                      </Link>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {shortAddress(s.address)} · {formatWindow(s.windowStart, s.windowEnd)}
                    </p>
                    <p className="text-xs">
                      {ORDER_TYPE_LABEL[s.orderType]}: entregar {s.totalDelivery}, coletar {s.totalCollection}
                    </p>
                    {s.statusReason && <p className="text-xs text-muted-foreground">{s.statusReason}</p>}
                  </div>
                  <StopStatusBadge status={s.status} />
                  {actions.edit && (
                    <div className="flex shrink-0 gap-1">
                      <Button size="icon" variant="ghost" aria-label={`Subir parada ${s.sequence}`} disabled={i === 0 || reorder.isPending} onClick={() => move(i, i - 1)}>
                        <ArrowUp aria-hidden />
                      </Button>
                      <Button size="icon" variant="ghost" aria-label={`Descer parada ${s.sequence}`} disabled={i === stops.length - 1 || reorder.isPending} onClick={() => move(i, i + 1)}>
                        <ArrowDown aria-hidden />
                      </Button>
                      <Button size="icon" variant="ghost" aria-label={`Remover parada ${s.sequence}`} disabled={remove.isPending} onClick={() => remove.mutate(s.id)}>
                        <Trash2 aria-hidden />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </Card>
          {r.notes && <p className="text-sm">Observações: {r.notes}</p>}
        </div>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Linha do tempo</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3 border-l pl-4">
              {q.data.events.map((e) => (
                <li key={e.id} className="relative text-sm">
                  <span className="absolute -left-[1.3rem] top-1.5 size-2.5 rounded-full bg-primary" aria-hidden />
                  <p className="font-medium">
                    {EVENT_LABEL[e.type] ?? e.type}
                    {e.type === 'STOP_STATUS' && e.to && `: ${STOP_STATUS_LABEL[e.to] ?? e.to}`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(e.at)} · {e.actorName ?? e.actorType}
                    {e.metadata.geolocation === 'unavailable' && ' · sem geolocalização'}
                  </p>
                  {e.reason && <p className="text-xs">{e.reason}</p>}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>

      {dialog === 'add' && <AddOrdersDialog routeId={id} date={r.date} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'cancel' && <CancelDialog routeId={id} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'edit' && <EditDialog route={r} onClose={() => setDialog(null)} onDone={refresh} />}
    </>
  );
}

function AddOrdersDialog({ routeId, date, onClose, onDone }: { routeId: string; date: string; onClose: () => void; onDone: () => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const orders = useQuery({ queryKey: ['plannable', date], queryFn: ({ signal }) => apiFetch<PlannableOrder[]>(`/api/admin/routes/plannable?date=${date}`, { signal }) });
  const add = useMutation({
    mutationFn: () => apiFetch(`/api/admin/routes/${routeId}/stops`, { body: { orderIds: selected } }),
    onSuccess: () => {
      toast.success('Pedidos adicionados à rota.');
      onDone();
      onClose();
    },
  });
  return (
    <Dialog open onClose={onClose} title="Adicionar pedidos" description="Entram no fim da rota, na ordem selecionada." className="max-w-2xl">
      {orders.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : orders.data?.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum outro pedido pronto nesta data.</p>
      ) : (
        <OrderPicker orders={orders.data ?? []} selected={selected} onToggle={(id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))} />
      )}
      {add.error && <Alert variant="destructive" className="mt-3">{describeApiError(add.error)}</Alert>}
      <div className="mt-4 flex justify-end">
        <Button disabled={selected.length === 0 || add.isPending} onClick={() => add.mutate()}>
          Adicionar {selected.length || ''}
        </Button>
      </div>
    </Dialog>
  );
}

function CancelDialog({ routeId, onClose, onDone }: { routeId: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const cancel = useMutation({
    mutationFn: () => apiFetch(`/api/admin/routes/${routeId}/cancel`, { body: { reason } }),
    onSuccess: () => {
      toast.success('Rota cancelada. Os pedidos voltaram para "Pronto".');
      onDone();
      onClose();
    },
  });
  return (
    <Dialog open onClose={onClose} title="Cancelar rota" description="Os pedidos voltam para &quot;Pronto&quot; e continuam com o estoque reservado, prontos para outra rota.">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); cancel.mutate(); }}>
        <Field id="cr-reason" label="Motivo" required>
          <Textarea id="cr-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {cancel.error && <Alert variant="destructive">{describeApiError(cancel.error)}</Alert>}
        <div className="flex justify-end">
          <Button type="submit" variant="destructive" disabled={reason.trim().length < 3 || cancel.isPending}>
            Cancelar rota
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function EditDialog({ route, onClose, onDone }: { route: RouteDetail['route']; onClose: () => void; onDone: () => void }) {
  const [driverId, setDriverId] = useState(route.driverId);
  const [vehicleId, setVehicleId] = useState(route.vehicleId);
  const drivers = useQuery({ queryKey: ['drivers'], queryFn: ({ signal }) => apiFetch<DriverOption[]>('/api/admin/drivers', { signal }) });
  const vehicles = useQuery({ queryKey: ['vehicles'], queryFn: ({ signal }) => apiFetch<VehicleOption[]>('/api/admin/vehicles', { signal }) });
  const save = useMutation({
    mutationFn: () => apiFetch(`/api/admin/routes/${route.id}`, { method: 'PATCH', body: { driverId, vehicleId } }),
    onSuccess: () => {
      toast.success('Rota atualizada.');
      onDone();
      onClose();
    },
  });
  return (
    <Dialog open onClose={onClose} title="Motorista e veículo">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Field id="e-driver" label="Motorista">
          <Select id="e-driver" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
            {drivers.data?.filter((d) => d.status === 'ACTIVE' || d.id === route.driverId).map((d) => (
              <option key={d.id} value={d.id}>
                {d.fullName}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="e-vehicle" label="Veículo">
          <Select id="e-vehicle" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            {vehicles.data?.filter((v) => v.status === 'ACTIVE' || v.id === route.vehicleId).map((v) => (
              <option key={v.id} value={v.id}>
                {formatPlate(v.plate)} · {v.model} · {v.capacity} toalhas
              </option>
            ))}
          </Select>
        </Field>
        {save.error && <Alert variant="destructive">{describeApiError(save.error)}</Alert>}
        <div className="flex justify-end">
          <Button type="submit" disabled={save.isPending}>
            Salvar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
