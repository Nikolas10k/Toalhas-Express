import { route, uuidParam } from '@/server/http/route';
import { cancelRoute, cancelRouteSchema } from '@/server/modules/routes/routes.service';

export const POST = route({
  auth: 'user',
  permission: 'route.manage',
  body: cancelRouteSchema,
  handler: async ({ actor, params, body }) => cancelRoute(actor, uuidParam(params), body.reason),
});
