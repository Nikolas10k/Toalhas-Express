import { json, route } from '@/server/http/route';
import { generateDeliveriesSchema, generateLinenDeliveries } from '@/server/modules/linen/linen.service';

/** Gera pedidos de entrega (confirmados) para o enxoval pronto, um por cliente. */
export const POST = route({
  auth: 'user',
  permission: 'order.create',
  body: generateDeliveriesSchema,
  requireIdempotencyKey: true,
  handler: async ({ actor, body, idempotencyKey }) => json(await generateLinenDeliveries(actor, body, idempotencyKey!), 201),
});
