import { route } from '@/server/http/route';
import { depotSchema, getDepot, updateDepot } from '@/server/modules/routes/routes.service';

export const GET = route({
  auth: 'user',
  permission: 'route.read',
  handler: async ({ actor }) => getDepot(actor),
});

export const PUT = route({
  auth: 'user',
  permission: 'route.manage',
  body: depotSchema,
  handler: async ({ actor, body }) => updateDepot(actor, body),
});
