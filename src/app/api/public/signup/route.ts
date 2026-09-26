import { selfSignupSchema } from '@/lib/validation/customers';
import { json, route } from '@/server/http/route';
import { getSignupAvailability, selfSignup } from '@/server/modules/customers/signup.service';

export const GET = route({
  auth: 'public',
  rateLimit: false,
  handler: async () => getSignupAvailability(),
});

export const POST = route({
  auth: 'public',
  body: selfSignupSchema,
  maxBodyBytes: 8 * 1024,
  handler: async ({ body }) => json(await selfSignup(body), 202),
});
