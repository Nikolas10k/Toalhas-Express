import { route, uuidParam } from '@/server/http/route';
import { contractTransitionSchema, transitionContract } from '@/server/modules/contracts/contracts.service';

export const POST = route({
  auth: 'user',
  permission: 'contract.manage',
  body: contractTransitionSchema,
  handler: async ({ actor, params, body }) => transitionContract(actor, uuidParam(params), body),
});
