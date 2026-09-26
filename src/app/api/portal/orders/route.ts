import { json, route } from '@/server/http/route';
import { createOrderByCustomer, listOwnOrders, portalOrderSchema } from '@/server/modules/orders/orders.service';

export const GET = route({
  auth: 'user',
  permission: 'portal.access',
  handler: async ({ actor }) => listOwnOrders(actor),
});

export const POST = route({
  auth: 'user',
  permission: 'portal.access',
  body: portalOrderSchema,
  requireIdempotencyKey: true,
  handler: async ({ actor, body, idempotencyKey }) => json(await createOrderByCustomer(actor, body, idempotencyKey!), 201),
});
