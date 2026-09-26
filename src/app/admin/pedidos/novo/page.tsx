import type { Metadata } from 'next';
import { requirePageActor } from '@/server/auth/guards';
import { NewOrder } from './new-order';

export const metadata: Metadata = { title: 'Novo pedido' };

export default async function NewOrderPage() {
  const actor = await requirePageActor('order.create', '/admin/pedidos/novo');
  return <NewOrder canConfirm={actor.permissions.has('order.update')} />;
}
