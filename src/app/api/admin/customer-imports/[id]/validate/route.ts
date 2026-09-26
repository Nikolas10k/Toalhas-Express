import { route, uuidParam } from '@/server/http/route';
import { importConfigSchema, validateCustomerImport } from '@/server/modules/customers/import.service';

export const maxDuration = 60;

export const POST = route({
  auth: 'user',
  permission: 'customer.import',
  body: importConfigSchema,
  handler: async ({ actor, params, body }) => validateCustomerImport(actor, uuidParam(params), body),
});
