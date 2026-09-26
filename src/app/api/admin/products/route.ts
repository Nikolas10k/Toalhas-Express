import { z } from 'zod';
import { json, route } from '@/server/http/route';
import { createProduct, createProductSchema, listProductsForActor } from '@/server/modules/inventory/inventory.service';

export const GET = route({
  auth: 'user',
  permission: 'product.read',
  query: z.strictObject({ includeInactive: z.enum(['true', 'false']).optional() }),
  handler: async ({ actor, query }) => listProductsForActor(actor, query.includeInactive === 'true'),
});

export const POST = route({
  auth: 'user',
  permission: 'product.manage',
  body: createProductSchema,
  handler: async ({ actor, body }) => json(await createProduct(actor, body), 201),
});
