import { z } from 'zod';
import { route, uuidParam } from '@/server/http/route';
import { anonymizeCustomer } from '@/server/modules/customers/customers.service';

export const POST = route({
  auth: 'user',
  permission: 'customer.anonymize',
  body: z.strictObject({ reason: z.string().trim().min(5).max(500), confirm: z.literal('ANONIMIZAR') }),
  handler: async ({ actor, params, body }) => anonymizeCustomer(actor, uuidParam(params), body.reason),
});
