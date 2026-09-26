import { route, uuidParam } from '@/server/http/route';
import { getRouteDetail, updateRoute, updateRouteSchema } from '@/server/modules/routes/routes.service';

export const GET = route({
  auth: 'user',
  permission: 'route.read',
  handler: async ({ actor, params }) => getRouteDetail(actor, uuidParam(params)),
});

export const PATCH = route({
  auth: 'user',
  permission: 'route.manage',
  body: updateRouteSchema,
  handler: async ({ actor, params, body }) => updateRoute(actor, uuidParam(params), body),
});
