import { json, route } from '@/server/http/route';
import { createDriver, driverSchema, listDrivers } from '@/server/modules/routes/fleet.service';

export const GET = route({
  auth: 'user',
  handler: async ({ actor }) => listDrivers(actor),
});

export const POST = route({
  auth: 'user',
  permission: 'driver.manage',
  body: driverSchema,
  handler: async ({ actor, body }) => json(await createDriver(actor, body), 201),
});
