import type { Metadata } from 'next';
import { requirePageActor } from '@/server/auth/guards';
import { MovementsList } from './movements-list';

export const metadata: Metadata = { title: 'Movimentações' };

export default async function MovementsPage() {
  const actor = await requirePageActor('inventory.read', '/admin/estoque/movimentacoes');
  return <MovementsList canReverse={actor.permissions.has('inventory.adjust')} />;
}
