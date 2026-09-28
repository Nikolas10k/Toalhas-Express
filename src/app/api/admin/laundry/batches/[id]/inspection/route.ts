import { route, uuidParam } from '@/server/http/route';
import { completeInspection, inspectionSchema } from '@/server/modules/laundry/laundry.service';

/** Conclui o lote com o destino de cada toalha. Repetir não duplica. */
export const POST = route({
  auth: 'user',
  permission: 'laundry.manage',
  body: inspectionSchema,
  handler: async ({ actor, params, body }) => completeInspection(actor, uuidParam(params), body),
});
