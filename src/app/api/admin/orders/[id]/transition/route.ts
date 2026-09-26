import { route, uuidParam } from '@/server/http/route';
import { transitionOrder, transitionSchema } from '@/server/modules/orders/orders.service';

/** Mudança manual de status. Permissão fina (update/cancel/override) validada no service. */
export const POST = route({
  auth: 'user',
  body: transitionSchema,
  handler: async ({ actor, params, body }) => transitionOrder(actor, uuidParam(params), body),
});
