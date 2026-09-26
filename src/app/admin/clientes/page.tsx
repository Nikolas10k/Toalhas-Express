import type { Metadata } from 'next';
import { requirePageActor } from '@/server/auth/guards';
import { CustomerList } from './customer-list';

export const metadata: Metadata = { title: 'Clientes' };

export default async function CustomersPage() {
  const actor = await requirePageActor('customer.read', '/admin/clientes');
  return (
    <CustomerList
      can={{
        create: actor.permissions.has('customer.create'),
        import: actor.permissions.has('customer.import'),
        update: actor.permissions.has('customer.update'),
      }}
    />
  );
}
