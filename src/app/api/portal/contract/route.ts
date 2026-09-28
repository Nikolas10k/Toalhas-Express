import { route } from '@/server/http/route';
import { getOwnContract } from '@/server/modules/contracts/contracts.service';

export const GET = route({
  auth: 'user',
  permission: 'portal.access',
  handler: async ({ actor }) => getOwnContract(actor),
});
