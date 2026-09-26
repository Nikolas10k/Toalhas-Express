import 'server-only';
import { withSystemTransaction } from '@/server/db/transaction';
import type { JobHandler } from './jobs.service';

export const MAINTENANCE_CLEANUP_JOB = 'maintenance.cleanup';

/** Remove apenas dados efêmeros (nunca ledgers, auditoria ou eventos). */
export const maintenanceCleanupHandler: JobHandler = async () => {
  await withSystemTransaction(async (tx) => {
    await tx`delete from public.rate_limit_buckets where window_start < now() - interval '2 days'`;
    await tx`delete from public.idempotency_keys where expires_at < now()`;
  });
};
