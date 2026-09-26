import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requirePageActor } from '@/server/auth/guards';
import { OrderDetailView } from './order-detail';

export const metadata: Metadata = { title: 'Pedido' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  await requirePageActor('order.read', `/admin/pedidos/${id}`);
  return <OrderDetailView id={id} />;
}
