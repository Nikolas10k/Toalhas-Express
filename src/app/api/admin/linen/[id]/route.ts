import { route, uuidParam } from '@/server/http/route';
import { getServiceOrderDetail } from '@/server/modules/linen/linen.service';

export const GET = route({
  auth: 'user',
  permission: 'laundry.read',
  handler: async ({ actor, params }) => getServiceOrderDetail(actor, uuidParam(params)),
});
