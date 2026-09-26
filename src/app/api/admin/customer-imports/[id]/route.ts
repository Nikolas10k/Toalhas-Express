import { route, uuidParam } from '@/server/http/route';
import { cancelCustomerImport, getCustomerImport } from '@/server/modules/customers/import.service';

export const GET = route({
  auth: 'user',
  permission: 'customer.import',
  handler: async ({ actor, params }) => getCustomerImport(actor, uuidParam(params)),
});

export const DELETE = route({
  auth: 'user',
  permission: 'customer.import',
  handler: async ({ actor, params }) => cancelCustomerImport(actor, uuidParam(params)),
});
