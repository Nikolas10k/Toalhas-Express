import { route, uuidParam } from '@/server/http/route';
import { advanceBatch, advanceBatchSchema } from '@/server/modules/laundry/laundry.service';

export const POST = route({
  auth: 'user',
  permission: 'laundry.manage',
  body: advanceBatchSchema,
  handler: async ({ actor, params, body }) => advanceBatch(actor, uuidParam(params), body),
});
