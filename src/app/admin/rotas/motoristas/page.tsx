import type { Metadata } from 'next';
import { requirePageActor } from '@/server/auth/guards';
import { DriversManager } from './drivers-manager';

export const metadata: Metadata = { title: 'Motoristas' };

export default async function DriversPage() {
  const actor = await requirePageActor('route.read', '/admin/rotas/motoristas');
  const p = actor.permissions;
  return <DriversManager canManage={p.has('driver.manage')} canLinkUsers={p.has('driver.manage') && p.has('users.read')} />;
}
