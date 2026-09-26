import { z } from 'zod';
import { route, uuidParam } from '@/server/http/route';
import { acknowledgeAlert } from '@/server/modules/inventory/alerts.service';

export const PATCH = route({
  auth: 'user',
  permission: 'inventory.adjust',
  body: z.strictObject({ status: z.literal('ACKNOWLEDGED') }),
  handler: async ({ actor, params }) => acknowledgeAlert(actor, uuidParam(params)),
});
