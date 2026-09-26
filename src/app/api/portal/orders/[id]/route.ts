import { route, uuidParam } from '@/server/http/route';
import { getOrderDetail } from '@/server/modules/orders/orders.service';

/** O service aplica a visão do cliente (sem notas internas) e o RLS limita aos pedidos dele. */
export const GET = route({
  auth: 'user',
  permission: 'portal.access',
  handler: async ({ actor, params }) => getOrderDetail(actor, uuidParam(params)),
});
