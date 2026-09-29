import { route, uuidParam } from '@/server/http/route';
import { markServiceOrderReady, readySchema } from '@/server/modules/linen/linen.service';

/** Enxoval saiu da lavanderia: confere as peças. Repetir não duplica. */
export const POST = route({
  auth: 'user',
  permission: 'laundry.manage',
  body: readySchema,
  handler: async ({ actor, params, body }) => markServiceOrderReady(actor, uuidParam(params), body),
});
