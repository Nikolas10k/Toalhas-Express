import { route, uuidParam } from '@/server/http/route';
import { requestCustomerGeocode } from '@/server/modules/customers/customers.service';

export const POST = route({
  auth: 'user',
  permission: 'customer.update',
  handler: async ({ actor, params }) => requestCustomerGeocode(actor, uuidParam(params)),
});
