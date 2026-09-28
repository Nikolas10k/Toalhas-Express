import { route, uuidParam } from '@/server/http/route';
import { getBatchDetail } from '@/server/modules/laundry/laundry.service';

export const GET = route({
  auth: 'user',
  permission: 'laundry.read',
  handler: async ({ actor, params }) => getBatchDetail(actor, uuidParam(params)),
});
