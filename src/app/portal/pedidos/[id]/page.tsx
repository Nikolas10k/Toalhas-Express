import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requirePageActor } from '@/server/auth/guards';
import { PortalOrderDetail } from './portal-order-detail';

export const metadata: Metadata = { title: 'Pedido' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function PortalOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  await requirePageActor('portal.access', `/portal/pedidos/${id}`);
  return <PortalOrderDetail id={id} />;
}
