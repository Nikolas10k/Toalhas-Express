import { route, uuidParam } from '@/server/http/route';
import { memberStatusSchema, setMemberStatus } from '@/server/modules/users/users.service';

export const POST = route({
  auth: 'user',
  permission: 'users.manage',
  body: memberStatusSchema,
  handler: async ({ actor, params, body }) => setMemberStatus(actor, uuidParam(params, 'memberId'), body),
});
