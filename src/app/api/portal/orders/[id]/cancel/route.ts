import { z } from 'zod';
import { route, uuidParam } from '@/server/http/route';
import { cancelOwnOrder } from '@/server/modules/orders/orders.service';

export const POST = route({
  auth: 'user',
  permission: 'portal.access',
  body: z.strictObject({ reason: z.string().trim().min(3).max(300) }),
  handler: async ({ actor, params, body }) => cancelOwnOrder(actor, uuidParam(params), body.reason),
});
