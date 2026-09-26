import { route, uuidParam } from '@/server/http/route';
import { getDriverRoute } from '@/server/modules/routes/driver-app.service';

export const GET = route({
  auth: 'user',
  permission: 'driver_app.access',
  handler: async ({ actor, params }) => getDriverRoute(actor, uuidParam(params)),
});
