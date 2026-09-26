import { route } from '@/server/http/route';
import { AuthorizationError } from '@/server/core/errors';
import { runWorkerCycle } from '@/server/modules/jobs/worker';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Worker de jobs/outbox. Acionado pela Vercel Cron (GET com
 * `Authorization: Bearer $CRON_SECRET`) ou pelo n8n (POST com token
 * INTEGRATION que tenha `jobs.run`).
 */
const handler = route({
  auth: 'cron',
  handler: async ({ actor }) => {
    if (actor.type === 'INTEGRATION' && !actor.permissions.has('jobs.run')) throw new AuthorizationError();
    return runWorkerCycle();
  },
});

export const GET = handler;
export const POST = handler;
