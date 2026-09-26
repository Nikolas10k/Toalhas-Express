import { z } from 'zod';
import { route, uuidParam } from '@/server/http/route';
import { listAuditLogsForActor } from '@/server/modules/audit/audit.service';

export const GET = route({
  auth: 'user',
  permission: 'audit.read',
  query: z.strictObject({ cursor: z.string().max(200).optional() }),
  handler: async ({ actor, params, query }) =>
    listAuditLogsForActor(actor, { entityType: 'customer', entityId: uuidParam(params), cursor: query.cursor, limit: 30 }),
});
