import { route } from '@/server/http/route';
import { getLaundryOverview } from '@/server/modules/laundry/laundry.service';

export const GET = route({
  auth: 'user',
  permission: 'laundry.read',
  handler: async ({ actor }) => getLaundryOverview(actor),
});
