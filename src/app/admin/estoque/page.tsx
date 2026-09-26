import type { Metadata } from 'next';
import { requirePageActor } from '@/server/auth/guards';
import { StockOverview } from './stock-overview';

export const metadata: Metadata = { title: 'Estoque' };

export default async function StockPage() {
  const actor = await requirePageActor('inventory.read', '/admin/estoque');
  const p = actor.permissions;
  return <StockOverview can={{ move: p.has('inventory.move'), adjust: p.has('inventory.adjust') }} />;
}
