import { json, route } from '@/server/http/route';
import { createRoute, createRouteSchema, listRoutes, routeListQuerySchema } from '@/server/modules/routes/routes.service';

export const GET = route({
  auth: 'user',
  permission: 'route.read',
  query: routeListQuerySchema,
  handler: async ({ actor, query }) => listRoutes(actor, query),
});

export const POST = route({
  auth: 'user',
  permission: 'route.manage',
  body: createRouteSchema,
  requireIdempotencyKey: true,
  handler: async ({ actor, body, idempotencyKey }) => json(await createRoute(actor, body, idempotencyKey), 201),
});
