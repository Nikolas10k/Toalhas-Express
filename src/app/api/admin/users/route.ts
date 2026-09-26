import { json, route } from '@/server/http/route';
import { inviteMember, inviteMemberSchema } from '@/server/modules/users/users.service';

export const POST = route({
  auth: 'user',
  permission: 'users.manage',
  body: inviteMemberSchema,
  handler: async ({ actor, body }) => json(await inviteMember(actor, body), 201),
});
