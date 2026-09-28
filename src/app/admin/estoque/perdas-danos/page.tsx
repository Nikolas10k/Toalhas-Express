import type { Metadata } from 'next';
import { IncidentsList } from '@/components/operations/incidents-list';
import { requirePageActor } from '@/server/auth/guards';

export const metadata: Metadata = { title: 'Perdas e danos' };

export default async function LossDamagePage() {
  const actor = await requirePageActor('incident.read', '/admin/estoque/perdas-danos');
  return <IncidentsList group="loss_damage" canReport={actor.permissions.has('incident.report') || actor.permissions.has('incident.manage')} />;
}
