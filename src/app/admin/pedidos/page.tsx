import type { Metadata } from 'next';
import { requirePageActor } from '@/server/auth/guards';
import { OrdersList } from './orders-list';

export const metadata: Metadata = { title: 'Pedidos' };

export default async function OrdersPage() {
  const actor = await requirePageActor('order.read', '/admin/pedidos');
  return <OrdersList canCreate={actor.permissions.has('order.create')} />;
}
