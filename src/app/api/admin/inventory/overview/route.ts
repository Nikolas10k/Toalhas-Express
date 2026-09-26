import { route } from '@/server/http/route';
import { getStockOverview } from '@/server/modules/inventory/inventory.service';

export const GET = route({
  auth: 'user',
  permission: 'inventory.read',
  handler: async ({ actor }) => getStockOverview(actor),
});
