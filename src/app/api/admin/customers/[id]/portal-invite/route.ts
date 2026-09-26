import { route, uuidParam } from '@/server/http/route';
import { inviteCustomerPortalUser, portalInviteSchema } from '@/server/modules/users/users.service';

export const POST = route({
  auth: 'user',
  permission: 'users.manage',
  body: portalInviteSchema,
  handler: async ({ actor, params, body }) => inviteCustomerPortalUser(actor, uuidParam(params), body),
});
