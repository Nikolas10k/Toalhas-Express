'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/page-header';
import { LinenReadyBanner } from '@/components/linen/linen-ready-banner';
import { formatScheduleDate, todayLocal } from '@/components/orders/labels';
import { OrderPicker } from '@/components/routes/order-picker';
import { RouteMap, type MapPoint } from '@/components/routes/route-map';
import type { DriverOption, PlannableResponse, VehicleOption } from '@/components/routes/types';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch, ApiError, describeApiError } from '@/lib/api-client';
import { formatPlate } from '@/lib/br/plate';
import { cn } from '@/lib/utils';
import type { Depot } from '../routes-list';

export function RoutePlanner({ initialDate }: { initialDate: string | null }) {
  const router = useRouter();
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());
  const [date, setDate] = useState(initialDate && initialDate >= todayLocal() ? initialDate : todayLocal());
  const [driverId, setDriverId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const orders = useQuery({
    queryKey: ['plannable', date],
    queryFn: ({ signal }) => apiFetch<PlannableResponse>(`/api/admin/routes/plannable?date=${date}`, { signal }),
  });
  const drivers = useQuery({ queryKey: ['drivers'], queryFn: ({ signal }) => apiFetch<DriverOption[]>('/api/admin/drivers', { signal }) });
  const vehicles = useQuery({ queryKey: ['vehicles'], queryFn: ({ signal }) => apiFetch<VehicleOption[]>('/api/admin/vehicles', { signal }) });
  const depot = useQuery({ queryKey: ['depot'], queryFn: ({ signal }) => apiFetch<Depot | null>('/api/admin/routes/depot', { signal }) });

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const byId = useMemo(() => new Map(orders.data?.orders.map((o) => [o.id, o])), [orders.data]);
  const vehicle = vehicles.data?.find((v) => v.id === vehicleId);
  const load = selected.reduce((a, id) => a + (byId.get(id)?.totalDelivery ?? 0), 0);
  const over = vehicle ? load > vehicle.capacity : false;
  const points: MapPoint[] = useMemo(
    () =>
      (orders.data?.orders ?? [])
        .filter((o) => o.latitude !== null && o.longitude !== null)
        .map((o) => {
          const idx = selected.indexOf(o.id);
          return {
            id: o.id,
            lat: o.latitude!,
            lng: o.longitude!,
            label: idx >= 0 ? String(idx + 1) : '·',
            title: `${o.customerName ?? 'Cliente'} (${o.number})`,
            tone: idx >= 0 ? ('selected' as const) : ('muted' as const),
          };
        })
        .sort((a, b) => (a.tone === 'selected' && b.tone === 'selected' ? selected.indexOf(a.id) - selected.indexOf(b.id) : a.tone === 'selected' ? -1 : 1)),
    [orders.data, selected],
  );

  const create = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string }>('/api/admin/routes', {
        idempotencyKey: idemKey,
        body: { routeDate: date, driverId, vehicleId: vehicleId || null, orderIds: selected, notes: notes || null },
      }),
    onSuccess: (r) => {
      toast.success('Rota criada. Pedidos atribuídos com o estoque reservado.');
      router.push(`/admin/rotas/${r.id}`);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) setIdemKey(crypto.randomUUID());
    },
  });
  const activeDrivers = drivers.data?.filter((d) => d.status === 'ACTIVE') ?? [];
  const activeVehicles = vehicles.data?.filter((v) => v.status === 'ACTIVE') ?? [];

  return (
    <>
      <Link href="/admin/rotas" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Rotas
      </Link>
      <PageHeader title="Nova rota" description="Selecione os pedidos na ordem de visita (lista ou clique no mapa). Depois você pode reordenar ou otimizar." />
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardContent className="grid gap-3 pt-6 sm:grid-cols-2">
              <Field id="r-date" label="Data" required>
                <Input
                  id="r-date"
                  type="date"
                  min={todayLocal()}
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setSelected([]);
                  }}
                />
              </Field>
              <Field id="r-driver" label="Motorista" required>
                <Select
                  id="r-driver"
                  value={driverId}
                  onChange={(e) => {
                    setDriverId(e.target.value);
                    const d = drivers.data?.find((x) => x.id === e.target.value);
                    if (d?.defaultVehicleId) setVehicleId(d.defaultVehicleId);
                  }}
                >
                  <option value="">Selecione…</option>
                  {activeDrivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.fullName}
                      {d.userId ? '' : ' (sem acesso ao app)'}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="r-vehicle" label="Veículo" required className="space-y-1.5 sm:col-span-2">
                <Select id="r-vehicle" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                  <option value="">Selecione…</option>
                  {activeVehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {formatPlate(v.plate)} · {v.model} · {v.capacity} toalhas
                    </option>
                  ))}
                </Select>
              </Field>
              {activeDrivers.length === 0 && drivers.isSuccess && (
                <Alert className="sm:col-span-2">
                  Cadastre um motorista em <Link href="/admin/rotas/motoristas" className="underline">Rotas → Motoristas</Link>.
                </Alert>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pedidos para {formatScheduleDate(date)}</CardTitle>
            </CardHeader>
            <CardContent>
              <LinenReadyBanner date={date} />
              {orders.error && <Alert variant="destructive">{describeApiError(orders.error)}</Alert>}
              {orders.isPending ? (
                <Skeleton className="h-40 w-full" />
              ) : orders.data?.orders.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhum pedido confirmado e sem rota nesta data. Pedidos aparecem aqui depois de confirmados em Pedidos.
                </p>
              ) : (
                <OrderPicker orders={orders.data?.orders ?? []} selected={selected} onToggle={toggle} />
              )}
              {(orders.data?.awaitingConfirmation ?? 0) > 0 && (
                <Alert className="mt-3">
                  {orders.data!.awaitingConfirmation} pedido(s) desta data ainda não foram confirmados e por isso não aparecem aqui.{' '}
                  <Link href={`/admin/pedidos?dateFrom=${date}&dateTo=${date}`} className="underline">
                    Ver pedidos
                  </Link>
                </Alert>
              )}
            </CardContent>
          </Card>
        </div>
        <div className="space-y-4 lg:col-span-3">
          <RouteMap
            points={points}
            depot={depot.data ? { lat: depot.data.latitude, lng: depot.data.longitude, name: depot.data.name } : null}
            onToggle={toggle}
            className="h-[28rem] w-full overflow-hidden rounded-md border"
          />
          <Card>
            <CardContent className="space-y-3 pt-6">
              <p className="text-sm">
                <strong>{selected.length}</strong> parada(s) · carga de entrega{' '}
                <strong className={cn(over && 'text-destructive')}>{load}</strong>
                {vehicle && <> de {vehicle.capacity} toalhas</>}
              </p>
              {vehicle && (
                <div className="h-2 w-full overflow-hidden rounded bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={vehicle.capacity} aria-valuenow={load} aria-label="Ocupação do veículo">
                  <div className={cn('h-full', over ? 'bg-destructive' : 'bg-primary')} style={{ width: `${Math.min(100, (load / vehicle.capacity) * 100)}%` }} />
                </div>
              )}
              {over && <Alert variant="destructive">A carga passa da capacidade do veículo. Troque o veículo ou tire pedidos.</Alert>}
              <Field id="r-notes" label="Observações para o motorista">
                <Textarea id="r-notes" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
              {create.error && <Alert variant="destructive">{describeApiError(create.error)}</Alert>}
              <div className="flex justify-end">
                <Button disabled={!driverId || !vehicleId || selected.length === 0 || over || create.isPending} onClick={() => create.mutate()}>
                  {create.isPending ? 'Criando…' : 'Criar rota'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
