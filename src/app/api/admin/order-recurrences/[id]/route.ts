import { z } from 'zod';
import { route, uuidParam } from '@/server/http/route';
import { setRecurringRuleActive } from '@/server/modules/orders/recurrence.service';

export const PATCH = route({
  auth: 'user',
  permission: 'order.create',
  body: z.strictObject({ active: z.boolean() }),
  handler: async ({ actor, params, body }) => setRecurringRuleActive(actor, uuidParam(params), body.active),
});
