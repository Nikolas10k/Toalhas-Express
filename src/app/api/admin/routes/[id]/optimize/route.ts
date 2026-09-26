import { route, uuidParam } from '@/server/http/route';
import { optimizeRoute } from '@/server/modules/routes/routes.service';

export const POST = route({
  auth: 'user',
  permission: 'route.manage',
  handler: async ({ actor, params }) => optimizeRoute(actor, uuidParam(params)),
});
