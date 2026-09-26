import { route } from '@/server/http/route';
import { enrollTotp } from '@/server/modules/auth/auth.service';

export const POST = route({
  auth: 'session',
  rateLimit: false,
  handler: async ({ claims }) => enrollTotp(claims),
});
