import 'server-only';
import { logger } from '@/server/core/logger';
import type { Tx } from '@/server/db/client';
import { withSystemTransaction } from '@/server/db/transaction';
import { recordAudit } from '@/server/modules/audit/audit.service';
import type { JobHandler } from '@/server/modules/jobs/jobs.service';

export const INVENTORY_CHECK_JOB = 'inventory.consistency_check';

interface AlertSpec {
  type: 'INVENTORY_INCONSISTENT' | 'NEGATIVE_BALANCE' | 'LOW_STOCK';
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  title: string;
  dedupeKey: string;
  details: Record<string, unknown>;
}

async function openAlert(tx: Tx, orgId: string, a: AlertSpec): Promise<boolean> {
  const r = await tx`
    insert into public.system_alerts (organization_id, alert_type, severity, title, details, dedupe_key)
    values (${orgId}, ${a.type}, ${a.severity}, ${a.title}, ${tx.json(a.details as never)}, ${a.dedupeKey})
    on conflict (organization_id, dedupe_key) where status <> 'RESOLVED' do nothing
  `;
  return r.count === 1;
}

/**
 * Verificação de consistência (SPEC §5): recalcula todos os saldos a partir do
 * ledger e compara com o cache; aponta saldos negativos e estoque abaixo do
 * mínimo. Só gera/resolve ALERTAS — nunca corrige dados automaticamente.
 */
export async function checkInventoryConsistency(orgId: string) {
  return withSystemTransaction(async (tx) => {
    const divergences = await tx<{ product_id: string; state: string; customer_id: string | null; ledger_quantity: string; cached_quantity: string }[]>`
      select * from app.inventory_consistency(${orgId})
    `;
    const negatives = await tx<{ product_id: string; state: string; customer_id: string | null; quantity: number }[]>`
      select product_id, state, customer_id, quantity from public.stock_balances where organization_id = ${orgId} and quantity < 0
    `;
    const low = await tx<{ id: string; name: string; min_stock: number; available: number }[]>`
      select p.id, p.name, p.min_stock, coalesce(b.quantity, 0) as available
        from public.products p
        left join public.stock_balances b
          on b.product_id = p.id and b.state = 'AVAILABLE' and b.customer_key = '00000000-0000-0000-0000-000000000000'
       where p.organization_id = ${orgId} and p.active and p.deleted_at is null and p.min_stock > 0
         and coalesce(b.quantity, 0) < p.min_stock
    `;

    const desired: AlertSpec[] = [];
    if (divergences.length) {
      desired.push({
        type: 'INVENTORY_INCONSISTENT',
        severity: 'CRITICAL',
        title: `Saldos de estoque não conferem com o ledger (${divergences.length} divergência(s))`,
        dedupeKey: 'INVENTORY_INCONSISTENT',
        details: { divergences: divergences.slice(0, 50) },
      });
    }
    for (const n of negatives) {
      desired.push({
        type: 'NEGATIVE_BALANCE',
        severity: 'WARNING',
        title: `Saldo negativo (${n.quantity}) em ${n.state}`,
        dedupeKey: `NEGATIVE_BALANCE:${n.product_id}:${n.state}:${n.customer_id ?? '-'}`,
        details: n,
      });
    }
    for (const p of low) {
      desired.push({
        type: 'LOW_STOCK',
        severity: 'WARNING',
        title: `Estoque abaixo do mínimo: ${p.name} (${p.available} de ${p.min_stock})`,
        dedupeKey: `LOW_STOCK:${p.id}`,
        details: { product_id: p.id, available: p.available, min_stock: p.min_stock },
      });
    }

    let opened = 0;
    for (const a of desired) if (await openAlert(tx, orgId, a)) opened += 1;

    // Alertas cuja condição sumiu são resolvidos (com trilha na auditoria).
    const keys = desired.map((d) => d.dedupeKey);
    const resolved = await tx<{ id: string; dedupe_key: string }[]>`
      update public.system_alerts set status = 'RESOLVED', resolved_at = now()
       where organization_id = ${orgId} and status <> 'RESOLVED'
         and alert_type in ('INVENTORY_INCONSISTENT', 'NEGATIVE_BALANCE', 'LOW_STOCK')
         and not (dedupe_key = any (${keys}::text[]))
      returning id, dedupe_key
    `;
    if (opened || resolved.length) {
      await recordAudit(tx, { type: 'SYSTEM', reason: 'inventory_consistency' }, orgId, {
        action: 'inventory.consistency_checked',
        entityType: 'organization',
        entityId: orgId,
        after: { divergences: divergences.length, negatives: negatives.length, low_stock: low.length, opened, resolved: resolved.length },
      });
    }
    if (divergences.length) logger.error('inventory.inconsistent', { organization_id: orgId, divergences: divergences.length });
    return { divergences: divergences.length, negatives: negatives.length, lowStock: low.length, opened, resolved: resolved.length };
  });
}

/** Job diário: verifica todas as organizações ativas. */
export const inventoryCheckHandler: JobHandler = async () => {
  const orgs = await withSystemTransaction(
    (tx) => tx<{ id: string }[]>`select id from public.organizations where status = 'active' and deleted_at is null`,
  );
  for (const o of orgs) await checkInventoryConsistency(o.id);
};
