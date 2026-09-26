import type { Metadata } from 'next';
import { requirePageActor } from '@/server/auth/guards';
import { ProductsManager } from './products-manager';

export const metadata: Metadata = { title: 'Produtos' };

export default async function ProductsPage() {
  const actor = await requirePageActor('product.read', '/admin/estoque/produtos');
  return <ProductsManager canManage={actor.permissions.has('product.manage')} />;
}
