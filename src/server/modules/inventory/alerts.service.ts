import 'server-only';
import { toDbContext, type UserActor } from '@/server/auth/actor';
import { authorize } from '@/server/authz/authorize';
import { NotFoundError } from '@/server/core/errors';
import { withActorTransaction } from '@/server/db/transaction';
import { recordAudit } from '@/server/modules/audit/audit.service';

/** "Ciente": o alerta continua visível até a condição ser resolvida na próxima verificação. */
export async function acknowledgeAlert(actor: UserActor, id: string) {
  authorize(actor, 'inventory.adjust');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const r = await tx`
      update public.system_alerts set status = 'ACKNOWLEDGED'
       where id = ${id} and organization_id = app.current_org_id() and status = 'OPEN'
    `;
    if (r.count === 0) throw new NotFoundError('Alerta não encontrado ou já tratado.');
    await recordAudit(tx, actor, actor.organizationId, { action: 'alert.acknowledged', entityType: 'system_alert', entityId: id });
    return { status: 'ACKNOWLEDGED' };
  });
}
