import { route, uuidParam } from '@/server/http/route';
import { finishRoute } from '@/server/modules/routes/driver-app.service';

/** Encerramento pela equipe (todas as paradas já com desfecho). */
export const POST = route({
  auth: 'user',
  permission: 'route.manage',
  handler: async ({ actor, params }) => finishRoute(actor, uuidParam(params), null),
});
