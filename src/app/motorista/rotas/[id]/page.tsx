import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requirePageActor } from '@/server/auth/guards';
import { DriverRouteView } from './driver-route';

export const metadata: Metadata = { title: 'Minha rota' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function DriverRoutePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  await requirePageActor('driver_app.access', `/motorista/rotas/${id}`);
  return <DriverRouteView id={id} />;
}
