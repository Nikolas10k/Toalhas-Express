import { z } from 'zod';
import { route, uuidParam } from '@/server/http/route';
import { simulateContractBilling } from '@/server/modules/contracts/contracts.service';

/** Quanto o contrato daria no mês, com o uso real. Não grava nada. */
export const GET = route({
  auth: 'user',
  permission: 'contract.read',
  query: z.strictObject({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }),
  handler: async ({ actor, params, query }) => simulateContractBilling(actor, uuidParam(params), query.month),
});
