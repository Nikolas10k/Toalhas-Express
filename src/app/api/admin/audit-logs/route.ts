import { route } from '@/server/http/route';
import { auditListQuerySchema, listAuditLogsForActor } from '@/server/modules/audit/audit.service';

export const GET = route({
  auth: 'user',
  permission: 'audit.read',
  query: auditListQuerySchema,
  handler: async ({ actor, query }) => listAuditLogsForActor(actor, query),
});
