import type { Metadata } from 'next';
import { requirePageActor } from '@/server/auth/guards';
import { OrdersList } from './orders-list';

export const metadata: Metadata = { title: 'Pedidos' };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ dateFrom?: string; dateTo?: string }> }) {
  const actor = await requirePageActor('order.read', '/admin/pedidos');
  const { dateFrom, dateTo } = await searchParams;
  return (
    <OrdersList
      canCreate={actor.permissions.has('order.create')}
      initialDateFrom={dateFrom && DATE.test(dateFrom) ? dateFrom : ''}
      initialDateTo={dateTo && DATE.test(dateTo) ? dateTo : ''}
    />
  );
}
