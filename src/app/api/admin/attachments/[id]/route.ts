import { route, uuidParam } from '@/server/http/route';
import { getAttachmentUrl } from '@/server/modules/attachments/attachments.service';

/** Link temporário (5 min) para a foto; nunca URL pública. */
export const GET = route({
  auth: 'user',
  permission: 'admin.access',
  handler: async ({ actor, params }) => getAttachmentUrl(actor, uuidParam(params)),
});
