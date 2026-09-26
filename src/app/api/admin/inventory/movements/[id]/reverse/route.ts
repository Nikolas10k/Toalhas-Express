import { z } from 'zod';
import { route, uuidParam } from '@/server/http/route';
import { reverseMovement } from '@/server/modules/inventory/inventory.service';

export const POST = route({
  auth: 'user',
  permission: 'inventory.adjust',
  body: z.strictObject({ reason: z.string().trim().min(5).max(500) }),
  handler: async ({ actor, params, body }) => reverseMovement(actor, uuidParam(params), body.reason),
});
