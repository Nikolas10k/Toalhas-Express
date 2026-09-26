import { json, route } from '@/server/http/route';
import {
  createOrderByStaff,
  listOrdersForActor,
  orderListQuerySchema,
  staffOrderSchema,
} from '@/server/modules/orders/orders.service';

export const GET = route({
  auth: 'user',
  permission: 'order.read',
  query: orderListQuerySchema,
  handler: async ({ actor, query }) => listOrdersForActor(actor, query),
});

/** Idempotency-Key evita pedido duplicado por duplo clique/retry. */
export const POST = route({
  auth: 'user',
  permission: 'order.create',
  body: staffOrderSchema,
  requireIdempotencyKey: true,
  handler: async ({ actor, body, idempotencyKey }) => json(await createOrderByStaff(actor, body, idempotencyKey), 201),
});
