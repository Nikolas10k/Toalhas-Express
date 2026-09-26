import { loginSchema } from '@/lib/validation/auth';
import { route } from '@/server/http/route';
import { login } from '@/server/modules/auth/auth.service';

export const POST = route({
  auth: 'public',
  body: loginSchema,
  maxBodyBytes: 4 * 1024,
  handler: async ({ body }) => login(body),
});
