import { route, uuidParam } from '@/server/http/route';
import { importRowsQuerySchema, listCustomerImportRows } from '@/server/modules/customers/import.service';

export const GET = route({
  auth: 'user',
  permission: 'customer.import',
  query: importRowsQuerySchema,
  handler: async ({ actor, params, query }) => listCustomerImportRows(actor, uuidParam(params), query),
});
