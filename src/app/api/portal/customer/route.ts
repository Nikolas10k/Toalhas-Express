import { portalCustomerUpdateSchema } from '@/lib/validation/customers';
import { route } from '@/server/http/route';
import { getOwnCustomer, updateOwnCustomer } from '@/server/modules/customers/customers.service';

export const GET = route({
  auth: 'user',
  permission: 'portal.access',
  handler: async ({ actor }) => getOwnCustomer(actor),
});

export const PATCH = route({
  auth: 'user',
  permission: 'portal.access',
  body: portalCustomerUpdateSchema,
  handler: async ({ actor, body }) => updateOwnCustomer(actor, body),
});
