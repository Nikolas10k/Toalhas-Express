import { route, uuidParam } from '@/server/http/route';
import { getStopServiceForm } from '@/server/modules/routes/operations.service';

export const GET = route({
  auth: 'user',
  permission: 'operation.execute',
  handler: async ({ actor, params }) => getStopServiceForm(actor, uuidParam(params)),
});
