import { route } from '@/server/http/route';
import { listMovementsForActor, movementListQuerySchema } from '@/server/modules/inventory/inventory.service';

export const GET = route({
  auth: 'user',
  permission: 'inventory.read',
  query: movementListQuerySchema,
  handler: async ({ actor, query }) => listMovementsForActor(actor, query),
});
