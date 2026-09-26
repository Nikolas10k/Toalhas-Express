import { route, uuidParam } from '@/server/http/route';
import { driverStopAction, stopActionSchema } from '@/server/modules/routes/driver-app.service';

/** "Ir para esta parada" e "Cheguei". Entregar/coletar/problema chegam na Fase 6. */
export const POST = route({
  auth: 'user',
  permission: 'driver_app.access',
  body: stopActionSchema,
  handler: async ({ actor, params, body }) => driverStopAction(actor, uuidParam(params), body),
});
