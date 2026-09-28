import { json, route } from '@/server/http/route';
import { contractListQuerySchema, createContract, createContractSchema, listContracts } from '@/server/modules/contracts/contracts.service';

export const GET = route({
  auth: 'user',
  permission: 'contract.read',
  query: contractListQuerySchema,
  handler: async ({ actor, query }) => listContracts(actor, query),
});

export const POST = route({
  auth: 'user',
  permission: 'contract.manage',
  body: createContractSchema,
  requireIdempotencyKey: true,
  handler: async ({ actor, body, idempotencyKey }) => json(await createContract(actor, body, idempotencyKey), 201),
});
