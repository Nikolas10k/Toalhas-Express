import { route, uuidParam } from '@/server/http/route';
import { getCustomerBalances } from '@/server/modules/inventory/inventory.service';

export const GET = route({
  auth: 'user',
  permission: 'inventory.read',
  handler: async ({ actor, params }) => getCustomerBalances(actor, uuidParam(params)),
});
