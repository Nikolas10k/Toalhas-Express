import type { Metadata } from 'next';
import { requirePageActor } from '@/server/auth/guards';
import { RoutesList } from './routes-list';

export const metadata: Metadata = { title: 'Rotas' };

export default async function RoutesPage() {
  const actor = await requirePageActor('route.read', '/admin/rotas');
  return <RoutesList canManage={actor.permissions.has('route.manage')} />;
}
