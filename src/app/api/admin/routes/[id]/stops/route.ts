import { route, uuidParam } from '@/server/http/route';
import { addStops, addStopsSchema } from '@/server/modules/routes/routes.service';

export const POST = route({
  auth: 'user',
  permission: 'route.manage',
  body: addStopsSchema,
  handler: async ({ actor, params, body }) => addStops(actor, uuidParam(params), body.orderIds),
});
