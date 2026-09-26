import { route } from '@/server/http/route';
import { listPortalCatalog } from '@/server/modules/inventory/inventory.service';

export const GET = route({
  auth: 'user',
  permission: 'portal.access',
  handler: async ({ actor }) => listPortalCatalog(actor),
});
