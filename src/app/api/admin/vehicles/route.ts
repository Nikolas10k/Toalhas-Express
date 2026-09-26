import { z } from 'zod';
import { json, route } from '@/server/http/route';
import { createVehicle, listVehicles, vehicleSchema } from '@/server/modules/routes/fleet.service';

export const GET = route({
  auth: 'user',
  query: z.strictObject({ activeOnly: z.enum(['true', 'false']).optional() }),
  handler: async ({ actor, query }) => listVehicles(actor, query.activeOnly !== 'true'),
});

export const POST = route({
  auth: 'user',
  permission: 'vehicle.manage',
  body: vehicleSchema,
  handler: async ({ actor, body }) => json(await createVehicle(actor, body), 201),
});
