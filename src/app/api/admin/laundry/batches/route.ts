import { json, route } from '@/server/http/route';
import { batchListQuerySchema, createBatch, createBatchSchema, listBatches } from '@/server/modules/laundry/laundry.service';

export const GET = route({
  auth: 'user',
  permission: 'laundry.read',
  query: batchListQuerySchema,
  handler: async ({ actor, query }) => listBatches(actor, query),
});

export const POST = route({
  auth: 'user',
  permission: 'laundry.manage',
  body: createBatchSchema,
  requireIdempotencyKey: true,
  handler: async ({ actor, body, idempotencyKey }) => json(await createBatch(actor, body, idempotencyKey), 201),
});
