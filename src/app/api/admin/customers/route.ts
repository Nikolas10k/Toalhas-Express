import { customerCreateSchema } from '@/lib/validation/customers';
import { json, route } from '@/server/http/route';
import { createCustomer, customerListQuerySchema, listCustomersForActor } from '@/server/modules/customers/customers.service';

export const GET = route({
  auth: 'user',
  permission: 'customer.read',
  query: customerListQuerySchema,
  handler: async ({ actor, query }) => listCustomersForActor(actor, query),
});

export const POST = route({
  auth: 'user',
  permission: 'customer.create',
  body: customerCreateSchema,
  handler: async ({ actor, body, idempotencyKey }) => json(await createCustomer(actor, body, idempotencyKey), 201),
});
