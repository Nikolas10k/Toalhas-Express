import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requirePageActor } from '@/server/auth/guards';
import { RouteDetailView } from './route-detail';

export const metadata: Metadata = { title: 'Rota' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function RoutePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  await requirePageActor('route.read', `/admin/rotas/${id}`);
  return <RouteDetailView id={id} />;
}
