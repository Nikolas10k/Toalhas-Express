import { customerStatusActionSchema } from '@/lib/validation/customers';
import { route, uuidParam } from '@/server/http/route';
import { changeCustomerStatus } from '@/server/modules/customers/customers.service';

export const POST = route({
  auth: 'user',
  body: customerStatusActionSchema,
  handler: async ({ actor, params, body }) => changeCustomerStatus(actor, uuidParam(params), body.action, body.reason),
});
