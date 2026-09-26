import { route } from '@/server/http/route';
import { getDriverHome } from '@/server/modules/routes/driver-app.service';

export const GET = route({
  auth: 'user',
  permission: 'driver_app.access',
  handler: async ({ actor }) => getDriverHome(actor),
});
