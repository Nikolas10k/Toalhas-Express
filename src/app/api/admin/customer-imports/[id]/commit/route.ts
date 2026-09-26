import { route, uuidParam } from '@/server/http/route';
import { commitCustomerImport } from '@/server/modules/customers/import.service';

export const maxDuration = 60;

export const POST = route({
  auth: 'user',
  permission: 'customer.import',
  handler: async ({ actor, params }) => commitCustomerImport(actor, uuidParam(params)),
});
