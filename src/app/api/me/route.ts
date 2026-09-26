import { route } from '@/server/http/route';

export const GET = route({
  auth: 'user',
  handler: async ({ actor }) => ({
    userId: actor.userId,
    email: actor.email,
    organizationId: actor.organizationId,
    roles: actor.roles,
    permissions: [...actor.permissions].sort(),
    mfa: { aal: actor.mfa.aal, required: actor.mfa.required },
  }),
});
