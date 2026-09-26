import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requirePageActor } from '@/server/auth/guards';
import { Customer360 } from './customer-360';

export const metadata: Metadata = { title: 'Cliente' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const actor = await requirePageActor('customer.read', `/admin/clientes/${id}`);
  const p = actor.permissions;
  return (
    <Customer360
      id={id}
      can={{
        update: p.has('customer.update'),
        approve: p.has('customer.approve'),
        audit: p.has('audit.read'),
        invite: p.has('users.manage'),
        exportData: p.has('customer.export'),
        anonymize: p.has('customer.anonymize'),
        inventory: p.has('inventory.read'),
        inventoryAdjust: p.has('inventory.adjust'),
        inventoryMove: p.has('inventory.move'),
        orders: p.has('order.read'),
        orderCreate: p.has('order.create'),
      }}
    />
  );
}
