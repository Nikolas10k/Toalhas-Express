import { json, route, uuidParam } from '@/server/http/route';
import { completeStop, completeStopSchema } from '@/server/modules/routes/operations.service';

/** Entrega + coleta + prova numa transação. Repetir o envio devolve o mesmo registro. */
export const POST = route({
  auth: 'user',
  permission: 'operation.execute',
  body: completeStopSchema,
  handler: async ({ actor, params, body }) => {
    const r = await completeStop(actor, uuidParam(params), body);
    return json(r, r.replayed ? 200 : 201);
  },
});
