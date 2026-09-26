import { mfaVerifySchema } from '@/lib/validation/auth';
import { route } from '@/server/http/route';
import { verifyTotp } from '@/server/modules/auth/auth.service';

export const POST = route({
  auth: 'session',
  body: mfaVerifySchema,
  maxBodyBytes: 1024,
  rateLimit: false,
  handler: async ({ body, claims }) => verifyTotp(claims, body),
});
