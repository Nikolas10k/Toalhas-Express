import type { Metadata } from 'next';
import { requirePageActor } from '@/server/auth/guards';
import { Recurrences } from './recurrences';

export const metadata: Metadata = { title: 'Recorrências' };

export default async function RecurrencesPage() {
  const actor = await requirePageActor('order.read', '/admin/pedidos/recorrencias');
  return <Recurrences canManage={actor.permissions.has('order.create')} />;
}
