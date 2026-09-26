import { route } from '@/server/http/route';
import { getOwnBalances } from '@/server/modules/inventory/inventory.service';

export const GET = route({
  auth: 'user',
  permission: 'portal.access',
  handler: async ({ actor }) => getOwnBalances(actor),
});
