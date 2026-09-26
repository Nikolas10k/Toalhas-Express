import { route, uuidParam } from '@/server/http/route';
import { reorderSchema, reorderStops } from '@/server/modules/routes/routes.service';

export const POST = route({
  auth: 'user',
  permission: 'route.manage',
  body: reorderSchema,
  handler: async ({ actor, params, body }) => reorderStops(actor, uuidParam(params), body.stopIds),
});
