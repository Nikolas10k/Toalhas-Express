import { route, uuidParam } from '@/server/http/route';
import { getIncidentDetail } from '@/server/modules/incidents/incidents.service';

export const GET = route({
  auth: 'user',
  permission: 'incident.read',
  handler: async ({ actor, params }) => getIncidentDetail(actor, uuidParam(params)),
});
