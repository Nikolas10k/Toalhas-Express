import { route, uuidParam } from '@/server/http/route';
import { productUpdateSchema, updateProductForActor } from '@/server/modules/inventory/inventory.service';

export const PATCH = route({
  auth: 'user',
  permission: 'product.manage',
  body: productUpdateSchema,
  handler: async ({ actor, params, body }) => updateProductForActor(actor, uuidParam(params), body),
});
