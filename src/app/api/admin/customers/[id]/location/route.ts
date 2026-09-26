import { customerLocationSchema } from '@/lib/validation/customers';
import { route, uuidParam } from '@/server/http/route';
import { setCustomerLocation } from '@/server/modules/customers/customers.service';

export const POST = route({
  auth: 'user',
  permission: 'customer.update',
  body: customerLocationSchema,
  handler: async ({ actor, params, body }) => setCustomerLocation(actor, uuidParam(params), body),
});
