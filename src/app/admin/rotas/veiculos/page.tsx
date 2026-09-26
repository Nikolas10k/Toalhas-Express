import type { Metadata } from 'next';
import { requirePageActor } from '@/server/auth/guards';
import { VehiclesManager } from './vehicles-manager';

export const metadata: Metadata = { title: 'Veículos' };

export default async function VehiclesPage() {
  const actor = await requirePageActor('route.read', '/admin/rotas/veiculos');
  return <VehiclesManager canManage={actor.permissions.has('vehicle.manage')} />;
}
