'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, MapPinned, Navigation, Phone, Play, Flag } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { formatScheduleDate, formatWindow, ORDER_TYPE_LABEL } from '@/components/orders/labels';
import { RouteStatusBadge, StopStatusBadge } from '@/components/routes/labels';
import { Alert } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch, describeApiError } from '@/lib/api-client';
import { formatPhone } from '@/lib/br/phone';
import { formatPlate } from '@/lib/br/plate';
import { cn } from '@/lib/utils';

interface DriverStop {
  id: string;
  sequence: number;
  status: string;
  orderNumber: string;
  type: string;
  customerName: string | null;
  phone: string | null;
  address: string;
  navigationUrl: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  notes: string | null;
  items: { name: string; deliveryQuantity: number; collectionQuantity: number }[];
}

interface DriverRoute {
  route: { id: string; date: string; status: string; vehiclePlate: string; vehicleModel: string; notes: string | null };
  canStart: boolean;
  canFinish: boolean;
  currentStopId: string | null;
  stops: DriverStop[];
}

type Geo = { latitude: number; longitude: number; accuracy: number | null } | null;

/** Geolocalização é registrada quando disponível; recusa ou timeout não bloqueiam a operação. */
function currentPosition(): Promise<Geo> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 30000 },
    );
  });
}

const OPEN = new Set(['PENDING', 'ON_THE_WAY', 'ARRIVED', 'IN_SERVICE']);

export function DriverRouteView({ id }: { id: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['driver-route', id],
    queryFn: ({ signal }) => apiFetch<DriverRoute>(`/api/driver/routes/${id}`, { signal }),
    refetchInterval: 60_000,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['driver-route', id] });
  const start = useMutation({
    mutationFn: async () => apiFetch(`/api/driver/routes/${id}/start`, { body: { geo: await currentPosition() } }),
    onSuccess: () => {
      toast.success('Rota iniciada. Boa viagem!');
      refresh();
    },
  });
  const finish = useMutation({
    mutationFn: async () => apiFetch(`/api/driver/routes/${id}/finish`, { body: { geo: await currentPosition() } }),
    onSuccess: () => {
      toast.success('Rota finalizada.');
      refresh();
    },
  });
  const stopAction = useMutation({
    mutationFn: async (v: { stopId: string; action: 'ON_THE_WAY' | 'ARRIVED' }) =>
      apiFetch(`/api/driver/stops/${v.stopId}`, { body: { action: v.action, geo: await currentPosition() } }),
    onSuccess: refresh,
  });

  if (q.isPending) return <Skeleton className="h-64 w-full" />;
  if (q.error) return <Alert variant="destructive">{describeApiError(q.error)}</Alert>;
  const { route: r, stops } = q.data;
  const current = stops.find((s) => s.id === q.data.currentStopId) ?? null;
  const next = current ?? stops.find((s) => s.status === 'PENDING') ?? null;
  const done = stops.filter((s) => !OPEN.has(s.status)).length;
  const error = start.error ?? finish.error ?? stopAction.error;

  return (
    <div className="space-y-4">
      <Link href="/motorista" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Minhas rotas
      </Link>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Rota de {formatScheduleDate(r.date)}</h1>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono">{formatPlate(r.vehiclePlate)}</span> {r.vehicleModel} · {done} de {stops.length} paradas feitas
          </p>
        </div>
        <RouteStatusBadge status={r.status} />
      </div>
      {r.notes && <Alert>{r.notes}</Alert>}
      {error && <Alert variant="destructive">{describeApiError(error)}</Alert>}

      {r.status === 'PLANNED' && (
        <Button className="h-14 w-full text-base" disabled={!q.data.canStart || start.isPending} onClick={() => start.mutate()}>
          <Play aria-hidden /> {start.isPending ? 'Iniciando…' : 'Iniciar rota'}
        </Button>
      )}
      {r.status === 'PLANNED' && !q.data.canStart && <p className="text-center text-sm text-muted-foreground">A rota pode ser iniciada no dia programado.</p>}

      {r.status === 'IN_PROGRESS' && next && (
        <Card className="border-primary">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-primary">{current ? 'Parada atual' : 'Próxima parada'}</p>
              <StopStatusBadge status={next.status} />
            </div>
            <StopInfo stop={next} large />
            <div className="grid grid-cols-2 gap-2">
              {next.navigationUrl && (
                <a href={next.navigationUrl} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: 'outline' }), 'h-12')}>
                  <Navigation aria-hidden /> Navegar
                </a>
              )}
              {next.phone && (
                <a href={`tel:${next.phone}`} className={cn(buttonVariants({ variant: 'outline' }), 'h-12')}>
                  <Phone aria-hidden /> Ligar
                </a>
              )}
            </div>
            {next.status === 'PENDING' && (
              <Button className="h-12 w-full" disabled={stopAction.isPending} onClick={() => stopAction.mutate({ stopId: next.id, action: 'ON_THE_WAY' })}>
                Ir para esta parada
              </Button>
            )}
            {next.status === 'ON_THE_WAY' && (
              <Button className="h-12 w-full" disabled={stopAction.isPending} onClick={() => stopAction.mutate({ stopId: next.id, action: 'ARRIVED' })}>
                <MapPinned aria-hidden /> Cheguei
              </Button>
            )}
            {(next.status === 'ARRIVED' || next.status === 'IN_SERVICE') && (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  {['Entregar', 'Coletar', 'Problema'].map((label) => (
                    <Button key={label} variant="outline" className="h-12" disabled>
                      {label}
                    </Button>
                  ))}
                </div>
                <p className="text-center text-xs text-muted-foreground">
                  Registro de entrega, coleta e problemas chega na próxima atualização do app. Por enquanto, informe a operação.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {r.status === 'IN_PROGRESS' && (
        <Button variant={q.data.canFinish ? 'default' : 'outline'} className="h-12 w-full" disabled={!q.data.canFinish || finish.isPending} onClick={() => finish.mutate()}>
          <Flag aria-hidden /> Finalizar rota
        </Button>
      )}

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Paradas</h2>
        <ol className="space-y-2">
          {stops.map((s) => (
            <li key={s.id}>
              <Card className={cn(s.id === next?.id && r.status === 'IN_PROGRESS' && 'ring-2 ring-primary', !OPEN.has(s.status) && 'opacity-70')}>
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="grid size-7 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{s.sequence}</span>
                    <StopStatusBadge status={s.status} />
                  </div>
                  <StopInfo stop={s} />
                  {r.status === 'IN_PROGRESS' && s.status === 'PENDING' && s.id !== next?.id && !current?.status.match(/ARRIVED|IN_SERVICE/) && (
                    <Button variant="outline" size="sm" className="w-full" disabled={stopAction.isPending} onClick={() => stopAction.mutate({ stopId: s.id, action: 'ON_THE_WAY' })}>
                      Ir para esta agora
                    </Button>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function StopInfo({ stop, large = false }: { stop: DriverStop; large?: boolean }) {
  return (
    <div className="space-y-1">
      <p className={cn('font-semibold', large && 'text-lg')}>{stop.customerName ?? 'Cliente'}</p>
      <p className="text-sm">{stop.address}</p>
      <p className="text-xs text-muted-foreground">
        {stop.orderNumber} · {ORDER_TYPE_LABEL[stop.type]} · {formatWindow(stop.windowStart, stop.windowEnd)}
        {stop.phone && ` · ${formatPhone(stop.phone)}`}
      </p>
      <ul className="text-sm">
        {stop.items.map((i) => (
          <li key={i.name}>
            {i.name}: {i.deliveryQuantity > 0 && <strong>entregar {i.deliveryQuantity}</strong>}
            {i.deliveryQuantity > 0 && i.collectionQuantity > 0 && ' · '}
            {i.collectionQuantity > 0 && <strong>coletar {i.collectionQuantity}</strong>}
          </li>
        ))}
      </ul>
      {stop.notes && <p className="rounded bg-muted p-2 text-sm">{stop.notes}</p>}
    </div>
  );
}
