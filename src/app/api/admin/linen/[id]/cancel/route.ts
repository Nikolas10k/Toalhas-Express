import { route, uuidParam } from '@/server/http/route';
import { cancelServiceOrder, cancelServiceOrderSchema } from '@/server/modules/linen/linen.service';

export const POST = route({
  auth: 'user',
  permission: 'laundry.manage',
  body: cancelServiceOrderSchema,
  handler: async ({ actor, params, body }) => cancelServiceOrder(actor, uuidParam(params), body),
});
