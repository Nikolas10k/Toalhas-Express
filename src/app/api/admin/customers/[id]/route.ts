import { customerUpdateSchema } from '@/lib/validation/customers';
import { route, uuidParam } from '@/server/http/route';
import { getCustomer360, updateCustomerByStaff } from '@/server/modules/customers/customers.service';

export const GET = route({
  auth: 'user',
  permission: 'customer.read',
  handler: async ({ actor, params }) => getCustomer360(actor, uuidParam(params)),
});

export const PATCH = route({
  auth: 'user',
  permission: 'customer.update',
  body: customerUpdateSchema,
  handler: async ({ actor, params, body }) => updateCustomerByStaff(actor, uuidParam(params), body),
});
