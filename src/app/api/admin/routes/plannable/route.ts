import { z } from 'zod';
import { route } from '@/server/http/route';
import { listPlannableOrders } from '@/server/modules/routes/routes.service';

export const GET = route({
  auth: 'user',
  permission: 'route.read',
  query: z.strictObject({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  handler: async ({ actor, query }) => listPlannableOrders(actor, query.date),
});
