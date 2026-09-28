import { route, uuidParam } from '@/server/http/route';
import { changeIncidentStatus, incidentStatusSchema } from '@/server/modules/incidents/incidents.service';

export const POST = route({
  auth: 'user',
  permission: 'incident.manage',
  body: incidentStatusSchema,
  handler: async ({ actor, params, body }) => changeIncidentStatus(actor, uuidParam(params), body),
});
