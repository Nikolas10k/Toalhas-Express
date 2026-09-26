import { updatePasswordSchema } from '@/lib/validation/auth';
import { route } from '@/server/http/route';
import { updatePassword } from '@/server/modules/auth/auth.service';

export const POST = route({
  auth: 'session',
  body: updatePasswordSchema,
  maxBodyBytes: 2 * 1024,
  handler: async ({ body, claims }) => {
    await updatePassword(claims, body);
    return { ok: true };
  },
});
