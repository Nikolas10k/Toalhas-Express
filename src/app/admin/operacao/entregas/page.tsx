import type { Metadata } from 'next';
import { OperationsList } from '@/components/operations/operations-list';
import { requirePageActor } from '@/server/auth/guards';

export const metadata: Metadata = { title: 'Entregas' };

export default async function Page() {
  await requirePageActor('route.read', '/admin/operacao/entregas');
  return <OperationsList kind="delivery" />;
}
