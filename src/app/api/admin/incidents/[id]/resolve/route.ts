import { route, uuidParam } from '@/server/http/route';
import { resolveIncident, resolveIncidentSchema } from '@/server/modules/incidents/incidents.service';

/** Aplica a decisão (movimentos + cobrança, se houver) uma única vez. */
export const POST = route({
  auth: 'user',
  permission: 'incident.manage',
  body: resolveIncidentSchema,
  handler: async ({ actor, params, body }) => resolveIncident(actor, uuidParam(params), body),
});
