import type { Metadata } from 'next';
import { z } from 'zod';
import { requirePageActor } from '@/server/auth/guards';
import { getCustomer360 } from '@/server/modules/customers/customers.service';
import { NewContract } from './new-contract';

export const metadata: Metadata = { title: 'Novo contrato' };

export default async function NewContractPage({ searchParams }: { searchParams: Promise<{ customerId?: string }> }) {
  const actor = await requirePageActor('contract.manage', '/admin/contratos/novo');
  const { customerId } = await searchParams;
  // Vindo da ficha do cliente: já abre com o cliente escolhido.
  const parsed = z.uuid().safeParse(customerId);
  const initialCustomer = parsed.success
    ? await getCustomer360(actor, parsed.data)
        .then(({ customer: c }) => ({ id: c.id, name: c.tradeName ?? c.legalName, status: c.status }))
        .catch(() => null)
    : null;
  return <NewContract initialCustomer={initialCustomer} />;
}
