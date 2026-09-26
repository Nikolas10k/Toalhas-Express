import type { Metadata } from 'next';
import { requirePageActor } from '@/server/auth/guards';
import { RoutePlanner } from './route-planner';

export const metadata: Metadata = { title: 'Nova rota' };

export default async function NewRoutePage({ searchParams }: { searchParams: Promise<{ data?: string }> }) {
  await requirePageActor('route.manage', '/admin/rotas/nova');
  const { data } = await searchParams;
  return <RoutePlanner initialDate={data && /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : null} />;
}
