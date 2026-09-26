import { json, route } from '@/server/http/route';
import { executeStockOperation, stockOperationSchema } from '@/server/modules/inventory/inventory.service';

/** Entrada, ajuste e transferência/dano/perda/descarte manuais. Permissão fina validada no service. */
export const POST = route({
  auth: 'user',
  body: stockOperationSchema,
  handler: async ({ actor, body, idempotencyKey }) => json(await executeStockOperation(actor, body, idempotencyKey), 201),
});
