import { z } from 'zod';
import { json, route } from '@/server/http/route';
import { createRecurringRule, listRecurringRules, recurringRuleSchema } from '@/server/modules/orders/recurrence.service';

export const GET = route({
  auth: 'user',
  permission: 'order.read',
  query: z.strictObject({ customerId: z.uuid().optional() }),
  handler: async ({ actor, query }) => listRecurringRules(actor, query.customerId),
});

export const POST = route({
  auth: 'user',
  permission: 'order.create',
  body: recurringRuleSchema,
  handler: async ({ actor, body }) => json(await createRecurringRule(actor, body), 201),
});
