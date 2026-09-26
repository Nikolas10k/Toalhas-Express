import 'server-only';
import { z } from 'zod';
import { toDbContext, type UserActor } from '@/server/auth/actor';
import { authorize } from '@/server/authz/authorize';
import { BusinessRuleError, NotFoundError } from '@/server/core/errors';
import { logger } from '@/server/core/logger';
import { withActorTransaction, withSystemTransaction } from '@/server/db/transaction';
import { recordAudit } from '@/server/modules/audit/audit.service';
import type { JobHandler } from '@/server/modules/jobs/jobs.service';
import { recordOutboxEvent } from '@/server/modules/outbox/outbox.service';
import { addDays, occurrencesBetween, todayInSaoPaulo, validateItems, type OrderType } from './orders.domain';
import { orderItemSchema } from './orders.service';

export const GENERATE_RECURRING_JOB = 'orders.generate_recurring';
export const RECURRENCE_HORIZON_DAYS = 7;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional().transform((v) => v || null);

export const recurringRuleSchema = z.strictObject({
  customerId: z.uuid(),
  type: z.enum(['DELIVERY', 'COLLECTION', 'DELIVERY_AND_COLLECTION']),
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  windowStart: hhmm,
  windowEnd: hhmm,
  items: z.array(orderItemSchema).min(1).max(20),
  notes: z.string().trim().max(1000).nullable().optional().transform((v) => v || null),
  startsOn: isoDate,
  endsOn: isoDate.nullable().optional().transform((v) => v || null),
});

export async function createRecurringRule(actor: UserActor, input: z.infer<typeof recurringRuleSchema>) {
  authorize(actor, 'order.create');
  validateItems(input.type, input.items);
  if (input.endsOn && input.endsOn < input.startsOn) throw new BusinessRuleError('Data final antes da inicial.');
  if (input.windowStart && input.windowEnd && input.windowEnd <= input.windowStart) throw new BusinessRuleError('Janela inválida.');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const [c] = await tx<{ status: string }[]>`select status from public.customers where id = ${input.customerId} and organization_id = app.current_org_id()`;
    if (!c) throw new NotFoundError('Cliente não encontrado.');
    const [{ id }] = (await tx`
      insert into public.recurring_order_rules (organization_id, customer_id, order_type, weekdays, window_start, window_end, items, notes, starts_on, ends_on, created_by)
      values (${actor.organizationId}, ${input.customerId}, ${input.type}, ${[...new Set(input.weekdays)].sort()}::smallint[],
              ${input.windowStart}, ${input.windowEnd}, ${tx.json(input.items)}, ${input.notes}, ${input.startsOn}, ${input.endsOn}, ${actor.userId})
      returning id
    `) as unknown as [{ id: string }];
    await recordAudit(tx, actor, actor.organizationId, { action: 'order_recurrence.created', entityType: 'recurring_order_rule', entityId: id, after: input });
    return { id };
  });
}

export async function setRecurringRuleActive(actor: UserActor, id: string, active: boolean) {
  authorize(actor, 'order.create');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const r = await tx`update public.recurring_order_rules set active = ${active} where id = ${id} and organization_id = app.current_org_id()`;
    if (r.count === 0) throw new NotFoundError('Regra não encontrada.');
    await recordAudit(tx, actor, actor.organizationId, { action: 'order_recurrence.updated', entityType: 'recurring_order_rule', entityId: id, after: { active } });
    return { active };
  });
}

export async function listRecurringRules(actor: UserActor, customerId?: string) {
  authorize(actor, 'order.read');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const rows = await tx<Record<string, unknown>[]>`
      select r.id, r.customer_id, coalesce(c.trade_name, c.legal_name) as customer_name, r.order_type, r.weekdays,
             to_char(r.window_start, 'HH24:MI') as window_start, to_char(r.window_end, 'HH24:MI') as window_end,
             r.items, r.notes, r.starts_on::text as starts_on, r.ends_on::text as ends_on, r.active, r.created_at
        from public.recurring_order_rules r
        left join public.customers c on c.id = r.customer_id
       where r.organization_id = app.current_org_id()
         ${customerId ? tx`and r.customer_id = ${customerId}` : tx``}
       order by r.active desc, customer_name
    `;
    return rows.map((r) => ({
      id: r.id as string,
      customerId: r.customer_id as string,
      customerName: r.customer_name as string | null,
      type: r.order_type as OrderType,
      weekdays: r.weekdays as number[],
      windowStart: r.window_start as string | null,
      windowEnd: r.window_end as string | null,
      items: r.items as { productId: string; deliveryQuantity: number; collectionQuantity: number }[],
      notes: r.notes as string | null,
      startsOn: r.starts_on as string,
      endsOn: r.ends_on as string | null,
      active: r.active as boolean,
    }));
  });
}

interface RuleRow {
  id: string;
  customer_id: string;
  order_type: OrderType;
  weekdays: number[];
  window_start: string | null;
  window_end: string | null;
  items: { productId: string; deliveryQuantity: number; collectionQuantity: number }[];
  notes: string | null;
  starts_on: string;
  ends_on: string | null;
}

/**
 * Gera pedidos NEW das regras ativas para os próximos N dias. Idempotente:
 * a ocorrência (regra, data) é única no banco e checada sob advisory lock,
 * então rodar duas vezes (ou em paralelo) nunca duplica pedido nem número.
 */
export async function generateRecurringOrders(organizationId: string, from = todayInSaoPaulo(), horizonDays = RECURRENCE_HORIZON_DAYS) {
  const to = addDays(from, horizonDays - 1);
  const rules = await withSystemTransaction(
    (tx) => tx<RuleRow[]>`
      select r.id, r.customer_id, r.order_type, r.weekdays, to_char(r.window_start, 'HH24:MI') as window_start,
             to_char(r.window_end, 'HH24:MI') as window_end, r.items, r.notes, r.starts_on::text as starts_on, r.ends_on::text as ends_on
        from public.recurring_order_rules r
        join public.customers c on c.id = r.customer_id
       where r.organization_id = ${organizationId} and r.active and c.status = 'active' and c.deleted_at is null
         and r.starts_on <= ${to}::date and (r.ends_on is null or r.ends_on >= ${from}::date)
    `,
  );
  let created = 0;
  for (const rule of rules) {
    for (const date of occurrencesBetween({ weekdays: rule.weekdays, startsOn: rule.starts_on, endsOn: rule.ends_on }, from, to)) {
      const inserted = await withSystemTransaction(async (tx) => {
        await tx`select set_config('app.org_id', ${organizationId}, true)`;
        await tx`select pg_advisory_xact_lock(hashtextextended(${`recurrence:${rule.id}:${date}`}, 0))`;
        const exists = await tx`select 1 from public.orders where recurring_rule_id = ${rule.id} and occurrence_date = ${date}`;
        if (exists.length) return false;
        const products = await tx<{ id: string }[]>`
          select id from public.products where organization_id = ${organizationId} and active and id = any (${rule.items.map((i) => i.productId)})`;
        if (products.length !== rule.items.length) {
          logger.warn('recurrence.skipped_inactive_product', { rule_id: rule.id, date });
          return false;
        }
        const [cust] = await tx<Record<string, unknown>[]>`
          select street, number, complement, district, city, state, postal_code, latitude, longitude from public.customers where id = ${rule.customer_id}`;
        const [{ n }] = (await tx`select app.next_order_number(${organizationId}) as n`) as unknown as [{ n: string }];
        const [{ id }] = (await tx`
          insert into public.orders (organization_id, number, customer_id, order_type, status, scheduled_date, window_start, window_end,
                                     address, latitude, longitude, notes, source, recurring_rule_id, occurrence_date)
          values (${organizationId}, ${n}, ${rule.customer_id}, ${rule.order_type}, 'NEW', ${date}, ${rule.window_start}, ${rule.window_end},
                  ${tx.json({ street: cust?.street ?? null, number: cust?.number ?? null, complement: cust?.complement ?? null, district: cust?.district ?? null, city: cust?.city ?? null, state: cust?.state ?? null, postalCode: cust?.postal_code ?? null } as never)},
                  ${(cust?.latitude as string | null) ?? null}, ${(cust?.longitude as string | null) ?? null}, ${rule.notes}, 'RECURRENCE', ${rule.id}, ${date})
          returning id
        `) as unknown as [{ id: string }];
        for (const it of rule.items) {
          await tx`
            insert into public.order_items (organization_id, order_id, product_id, delivery_quantity, collection_quantity)
            values (${organizationId}, ${id}, ${it.productId}, ${it.deliveryQuantity}, ${it.collectionQuantity})`;
        }
        await tx`
          insert into public.order_status_history (organization_id, order_id, from_status, to_status, metadata, actor_type)
          values (${organizationId}, ${id}, null, 'NEW', ${tx.json({ source: 'RECURRENCE', rule_id: rule.id })}, 'SYSTEM')`;
        await recordAudit(tx, { type: 'SYSTEM', reason: 'recurrence' }, organizationId, {
          action: 'order.created',
          entityType: 'order',
          entityId: id,
          after: { number: n, rule_id: rule.id, occurrence_date: date },
          metadata: { source: 'RECURRENCE' },
        });
        await recordOutboxEvent(tx, {
          organizationId,
          eventType: 'OrderCreated',
          aggregateType: 'order',
          aggregateId: id,
          payload: { order_id: id, number: n, customer_id: rule.customer_id, status: 'NEW', source: 'RECURRENCE' },
          idempotencyKey: `OrderCreated:${id}`,
        });
        return true;
      });
      if (inserted) created += 1;
    }
  }
  return { created, rules: rules.length };
}

export const generateRecurringHandler: JobHandler = async () => {
  const orgs = await withSystemTransaction(
    (tx) => tx<{ id: string }[]>`select id from public.organizations where status = 'active' and deleted_at is null`,
  );
  for (const o of orgs) await generateRecurringOrders(o.id);
};
