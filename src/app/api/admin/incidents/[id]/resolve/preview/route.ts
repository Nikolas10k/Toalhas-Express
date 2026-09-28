import { route, uuidParam } from '@/server/http/route';
import { previewResolution, resolveIncidentSchema } from '@/server/modules/incidents/incidents.service';

/** Impacto antes de confirmar (movimentos e valor). Não grava nada. */
export const POST = route({
  auth: 'user',
  permission: 'incident.manage',
  body: resolveIncidentSchema,
  handler: async ({ actor, params, body }) => previewResolution(actor, uuidParam(params), body),
});
