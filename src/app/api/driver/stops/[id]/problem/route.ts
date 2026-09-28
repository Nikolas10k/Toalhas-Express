import { json, route, uuidParam } from '@/server/http/route';
import { reportStopProblem, stopProblemSchema } from '@/server/modules/routes/operations.service';

export const POST = route({
  auth: 'user',
  permission: 'incident.report',
  body: stopProblemSchema,
  handler: async ({ actor, params, body }) => json(await reportStopProblem(actor, uuidParam(params), body), 201),
});
