import type { Metadata } from 'next';
import { requirePageActor } from '@/server/auth/guards';
import { ContractsList } from './contracts-list';

export const metadata: Metadata = { title: 'Contratos' };

export default async function ContractsPage() {
  const actor = await requirePageActor('contract.read', '/admin/contratos');
  return <ContractsList canManage={actor.permissions.has('contract.manage')} />;
}
