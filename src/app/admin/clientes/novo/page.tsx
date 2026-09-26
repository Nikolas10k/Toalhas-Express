import type { Metadata } from 'next';
import { requirePageActor } from '@/server/auth/guards';
import { NewCustomer } from './new-customer';

export const metadata: Metadata = { title: 'Novo cliente' };

export default async function NewCustomerPage() {
  await requirePageActor('customer.create', '/admin/clientes/novo');
  return <NewCustomer />;
}
