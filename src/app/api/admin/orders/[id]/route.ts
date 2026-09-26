import { route, uuidParam } from '@/server/http/route';
import { getOrderDetail } from '@/server/modules/orders/orders.service';

export const GET = route({
  auth: 'user',
  permission: 'order.read',
  handler: async ({ actor, params }) => getOrderDetail(actor, uuidParam(params)),
});
