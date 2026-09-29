import { route } from '@/server/http/route';
import { listServiceOrders, serviceOrderListQuerySchema } from '@/server/modules/linen/linen.service';

export const GET = route({
  auth: 'user',
  permission: 'laundry.read',
  query: serviceOrderListQuerySchema,
  handler: async ({ actor, query }) => listServiceOrders(actor, query),
});
