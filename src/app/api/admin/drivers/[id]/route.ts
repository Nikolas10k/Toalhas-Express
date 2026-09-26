import { route, uuidParam } from '@/server/http/route';
import { driverUpdateSchema, updateDriver } from '@/server/modules/routes/fleet.service';

export const PATCH = route({
  auth: 'user',
  permission: 'driver.manage',
  body: driverUpdateSchema,
  handler: async ({ actor, params, body }) => updateDriver(actor, uuidParam(params), body),
});
