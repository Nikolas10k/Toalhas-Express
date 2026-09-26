import { route } from '@/server/http/route';
import { logout } from '@/server/modules/auth/auth.service';

export const POST = route({
  auth: 'public',
  handler: async () => {
    await logout();
    return { ok: true };
  },
});
