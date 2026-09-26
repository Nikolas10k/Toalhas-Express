import { route } from '@/server/http/route';
import { listDriverUserCandidates } from '@/server/modules/routes/fleet.service';

export const GET = route({
  auth: 'user',
  permission: 'driver.manage',
  handler: async ({ actor }) => listDriverUserCandidates(actor),
});
