import { z } from 'zod';
import { route, uuidParam } from '@/server/http/route';
import { geoSchema, startRoute } from '@/server/modules/routes/driver-app.service';

export const POST = route({
  auth: 'user',
  permission: 'driver_app.access',
  body: z.strictObject({ geo: geoSchema }),
  handler: async ({ actor, params, body }) => startRoute(actor, uuidParam(params), body.geo),
});
