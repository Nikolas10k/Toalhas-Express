import { json, route } from '@/server/http/route';
import { productionSchema, registerProduction } from '@/server/modules/laundry/laundry.service';

/** Lança o que saiu limpo e dobrado (boas, com dano, descarte) num passo só. */
export const POST = route({
  auth: 'user',
  permission: 'laundry.manage',
  body: productionSchema,
  requireIdempotencyKey: true,
  handler: async ({ actor, body, idempotencyKey }) => json(await registerProduction(actor, body, idempotencyKey!), 201),
});
