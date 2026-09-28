import type { Metadata } from 'next';
import { IncidentsList } from '@/components/operations/incidents-list';
import { requirePageActor } from '@/server/auth/guards';

export const metadata: Metadata = { title: 'Ocorrências' };

export default async function IncidentsPage() {
  const actor = await requirePageActor('incident.read', '/admin/operacao/ocorrencias');
  return <IncidentsList canReport={actor.permissions.has('incident.report') || actor.permissions.has('incident.manage')} />;
}
