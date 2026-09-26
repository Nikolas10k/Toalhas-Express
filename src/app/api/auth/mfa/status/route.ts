import { route } from '@/server/http/route';
import { getMfaStatus } from '@/server/modules/auth/auth.service';

export const GET = route({
  auth: 'session',
  handler: async () => getMfaStatus(),
});
