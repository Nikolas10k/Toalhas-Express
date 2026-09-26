import { route, uuidParam } from '@/server/http/route';
import { updateVehicle, vehicleUpdateSchema } from '@/server/modules/routes/fleet.service';

export const PATCH = route({
  auth: 'user',
  permission: 'vehicle.manage',
  body: vehicleUpdateSchema,
  handler: async ({ actor, params, body }) => updateVehicle(actor, uuidParam(params), body),
});
