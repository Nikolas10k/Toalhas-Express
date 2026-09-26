import { route } from '@/server/http/route';
import { requestBulkGeocode } from '@/server/modules/customers/customers.service';

export const POST = route({
  auth: 'user',
  permission: 'customer.update',
  handler: async ({ actor }) => requestBulkGeocode(actor),
});
