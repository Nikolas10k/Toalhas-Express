import type { Metadata } from 'next';
import { requirePageActor } from '@/server/auth/guards';
import { ProductsManager } from './products-manager';

export const metadata: Metadata = { title: 'Produtos' };

export default async function ProductsPage() {
  const actor = await requirePageActor('product.read', '/admin/estoque/produtos');
  const p = actor.permissions;
  return <ProductsManager canManage={p.has('product.manage')} canSeeStock={p.has('inventory.read')} canEnterStock={p.has('inventory.move')} />;
}
