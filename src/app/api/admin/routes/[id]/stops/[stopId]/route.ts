import { route, uuidParam } from '@/server/http/route';
import { removeStop } from '@/server/modules/routes/routes.service';

export const DELETE = route({
  auth: 'user',
  permission: 'route.manage',
  handler: async ({ actor, params }) => removeStop(actor, uuidParam(params), uuidParam(params, 'stopId')),
});
