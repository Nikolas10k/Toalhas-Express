import { z } from 'zod';
import { route } from '@/server/http/route';
import { listOperations } from '@/server/modules/routes/operations.service';

export const GET = route({
  auth: 'user',
  permission: 'route.read',
  query: z.strictObject({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    customerId: z.uuid().optional(),
    routeId: z.uuid().optional(),
    kind: z.enum(['delivery', 'collection']).optional(),
    page: z.coerce.number().int().min(1).max(500).default(1),
  }),
  handler: async ({ actor, query }) => listOperations(actor, query),
});
