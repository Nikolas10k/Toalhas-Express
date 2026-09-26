import { ChevronRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatScheduleDate } from '@/components/orders/labels';
import { RouteStatusBadge } from '@/components/routes/labels';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { formatPlate } from '@/lib/br/plate';
import { requirePageActor } from '@/server/auth/guards';
import { AppError } from '@/server/core/errors';
import { getDriverHome } from '@/server/modules/routes/driver-app.service';

export const metadata: Metadata = { title: 'App do motorista' };

export default async function DriverHome() {
  const actor = await requirePageActor('driver_app.access', '/motorista');
  let data: Awaited<ReturnType<typeof getDriverHome>> | null = null;
  let problem: string | null = null;
  try {
    data = await getDriverHome(actor);
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    problem = err.publicMessage;
  }
  if (problem) return <Alert>{problem}</Alert>;
  const routes = data!.routes;
  const todays = routes.filter((r) => r.date === data!.today || r.status === 'IN_PROGRESS');
  const upcoming = routes.filter((r) => !todays.includes(r));

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h1 className="text-xl font-semibold">Rota de hoje</h1>
        {todays.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma rota para hoje.</p>}
        {todays.map((r) => (
          <RouteCard key={r.id} r={r} />
        ))}
      </section>
      {upcoming.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">Próximas</h2>
          {upcoming.map((r) => (
            <RouteCard key={r.id} r={r} />
          ))}
        </section>
      )}
    </div>
  );
}

function RouteCard({ r }: { r: { id: string; date: string; status: string; vehiclePlate: string; stops: number; openStops: number } }) {
  return (
    <Link href={`/motorista/rotas/${r.id}`} className="block rounded-lg focus-visible:ring-2 focus-visible:ring-ring">
      <Card className="hover:bg-accent">
        <CardContent className="flex items-center justify-between gap-3 p-4">
          <div>
            <p className="font-medium">
              {formatScheduleDate(r.date)} · <span className="font-mono">{formatPlate(r.vehiclePlate)}</span>
            </p>
            <p className="text-sm text-muted-foreground">
              {r.status === 'IN_PROGRESS' ? `${r.stops - r.openStops} de ${r.stops} paradas feitas` : `${r.stops} parada(s)`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <RouteStatusBadge status={r.status} />
            <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
