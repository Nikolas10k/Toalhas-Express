import { route, uuidParam } from '@/server/http/route';
import { assignIncident, assignIncidentSchema } from '@/server/modules/incidents/incidents.service';

export const POST = route({
  auth: 'user',
  permission: 'incident.manage',
  body: assignIncidentSchema,
  handler: async ({ actor, params, body }) => assignIncident(actor, uuidParam(params), body.userId),
});
