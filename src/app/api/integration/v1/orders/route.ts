import { json, route } from '@/server/http/route';
import { createDraftOrderByIntegration, integrationOrderSchema } from '@/server/modules/orders/orders.service';

/**
 * n8n: cria pedido em RASCUNHO (DRAFT) para confirmação humana. Retry com a
 * mesma Idempotency-Key devolve o mesmo pedido (200) em vez de duplicar.
 */
export const POST = route({
  auth: 'integration',
  permission: 'order.create_draft',
  body: integrationOrderSchema,
  requireIdempotencyKey: true,
  handler: async ({ actor, body, idempotencyKey }) => {
    const { replayed, ...order } = await createDraftOrderByIntegration(actor, body, idempotencyKey!);
    return json({ ...order, status: 'DRAFT', replayed }, replayed ? 200 : 201);
  },
});
