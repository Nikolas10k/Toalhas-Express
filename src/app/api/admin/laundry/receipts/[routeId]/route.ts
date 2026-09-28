import { json, route, uuidParam } from '@/server/http/route';
import { receiveRoute, receiveRouteSchema } from '@/server/modules/laundry/laundry.service';

/** Conferência do que chegou das coletas de uma rota (uma vez por rota). */
export const POST = route({
  auth: 'user',
  permission: 'laundry.manage',
  body: receiveRouteSchema,
  handler: async ({ actor, params, body }) => {
    const r = await receiveRoute(actor, uuidParam(params, 'routeId'), body);
    return json(r, r.replayed ? 200 : 201);
  },
});
