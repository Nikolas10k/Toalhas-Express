import type { Metadata } from 'next';
import { requirePageActor } from '@/server/auth/guards';
import { LaundryOverview } from './laundry-overview';

export const metadata: Metadata = { title: 'Lavanderia' };

export default async function LaundryPage() {
  const actor = await requirePageActor('laundry.read', '/admin/estoque/lavanderia');
  return <LaundryOverview canManage={actor.permissions.has('laundry.manage')} />;
}
