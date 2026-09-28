import { route, uuidParam } from '@/server/http/route';
import { getContractDetail, updateContract, updateContractSchema } from '@/server/modules/contracts/contracts.service';

export const GET = route({
  auth: 'user',
  permission: 'contract.read',
  handler: async ({ actor, params }) => getContractDetail(actor, uuidParam(params)),
});

/** Substitui os termos (com revisão e auditoria). Contrato vigente exige motivo. */
export const PUT = route({
  auth: 'user',
  permission: 'contract.manage',
  body: updateContractSchema,
  handler: async ({ actor, params, body }) => updateContract(actor, uuidParam(params), body),
});
