import { route, uuidParam } from '@/server/http/route';
import { memberRolesSchema, setMemberRoles } from '@/server/modules/users/users.service';

export const PUT = route({
  auth: 'user',
  permission: 'permissions.manage',
  body: memberRolesSchema,
  handler: async ({ actor, params, body }) => setMemberRoles(actor, uuidParam(params, 'memberId'), body),
});
