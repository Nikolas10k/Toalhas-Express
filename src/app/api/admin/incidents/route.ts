import { json, route } from '@/server/http/route';
import { incidentListQuerySchema, listIncidents, reportIncident, reportIncidentSchema } from '@/server/modules/incidents/incidents.service';

export const GET = route({
  auth: 'user',
  permission: 'incident.read',
  query: incidentListQuerySchema,
  handler: async ({ actor, query }) => listIncidents(actor, query),
});

export const POST = route({
  auth: 'user',
  body: reportIncidentSchema,
  handler: async ({ actor, body }) => json(await reportIncident(actor, body), 201),
});
