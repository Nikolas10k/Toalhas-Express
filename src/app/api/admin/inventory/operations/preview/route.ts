import { route } from '@/server/http/route';
import { previewStockOperation, stockOperationSchema } from '@/server/modules/inventory/inventory.service';

export const POST = route({
  auth: 'user',
  permission: 'inventory.read',
  body: stockOperationSchema,
  handler: async ({ actor, body }) => previewStockOperation(actor, body),
});
