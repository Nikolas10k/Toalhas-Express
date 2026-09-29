import 'server-only';
import { z } from 'zod';
import { toDbContext, type UserActor } from '@/server/auth/actor';
import { authorize, hasPermission } from '@/server/authz/authorize';
import { BusinessRuleError, NotFoundError, ValidationError } from '@/server/core/errors';
import type { Tx } from '@/server/db/client';
import { withActorTransaction } from '@/server/db/transaction';
import { recordAudit } from '@/server/modules/audit/audit.service';
import { executeIdempotent } from '@/server/modules/idempotency/idempotency.service';
import { createIncidentRow, openIncidentAlert } from '@/server/modules/incidents/incidents.service';
import { formatOrderNumber, todayInSaoPaulo } from '@/server/modules/orders/orders.domain';
import { createLinenDeliveryOrder } from '@/server/modules/orders/orders.service';
import { recordOutboxEvent } from '@/server/modules/outbox/outbox.service';
import { distributeDelivered, formatServiceOrderNumber, readyDivergences, SERVICE_ORDER_STATUSES, serviceOrderStateMachine, type ServiceOrderStatus } from './linen.domain';

type Alert = { id: string; number: string; type: 'QUANTITY_DIVERGENCE'; title: string };

async function event(tx: Tx, actor: UserActor, id: string, from: string | null, to: string, note: string | null = null) {
  await tx`
    insert into public.linen_service_order_events (organization_id, service_order_id, from_status, to_status, note, actor_type, actor_id, created_at)
    values (${actor.organizationId}, ${id}, ${from}, ${to}, ${note}, 'USER', ${actor.userId}, clock_timestamp())`;
}

// -----------------------------------------------------------------------------
// Na parada (chamado pelo atendimento, dentro da transação da parada)
// -----------------------------------------------------------------------------

/** Coleta de enxoval: abre a OS com o rol contado pelo motorista. */
export async function openServiceOrderAtStop(
  tx: Tx,
  actor: UserActor,
  a: { customerId: string; operationId: string; items: { productId: string; collected: number; damaged: number }[]; notes: string | null },
) {
  const items = a.items.filter((i) => i.collected > 0);
  if (items.length === 0) return null;
  const [{ n }] = (await tx`select app.next_service_order_number(${actor.organizationId}) as n`) as unknown as [{ n: string }];
  const [so] = await tx<{ id: string }[]>`
    insert into public.linen_service_orders (organization_id, number, customer_id, collection_operation_id, notes, created_by)
    values (${actor.organizationId}, ${n}, ${a.customerId}, ${a.operationId}, ${a.notes}, ${actor.userId}) returning id`;
  const id = so!.id;
  for (const i of items) {
    await tx`
      insert into public.linen_service_order_items (organization_id, service_order_id, product_id, collected, damaged_on_arrival)
      values (${actor.organizationId}, ${id}, ${i.productId}, ${i.collected}, ${i.damaged})`;
  }
  await event(tx, actor, id, null, 'COLLECTED');
  const total = items.reduce((s, i) => s + i.collected, 0);
  await recordAudit(tx, actor, actor.organizationId, { action: 'linen.collected', entityType: 'linen_service_order', entityId: id, after: { number: n, customer_id: a.customerId, items } });
  await recordOutboxEvent(tx, {
    organizationId: actor.organizationId,
    eventType: 'LinenCollected',
    aggregateType: 'linen_service_order',
    aggregateId: id,
    payload: { service_order_id: id, number: n, customer_id: a.customerId, pieces: total },
    idempotencyKey: `LinenCollected:${id}`,
  });
  return { id, number: formatServiceOrderNumber(n) };
}

/** Entrega do enxoval pronto: fecha as OS vinculadas ao pedido da parada. */
export async function deliverServiceOrdersAtStop(
  tx: Tx,
  actor: UserActor,
  a: { orderId: string; operationId: string; delivered: Map<string, number> },
) {
  const rows = await tx<{ id: string; number: string; product_id: string; returned: number }[]>`
    select s.id, s.number::text as number, i.product_id, coalesce(i.returned, 0) as returned
      from public.linen_service_orders s join public.linen_service_order_items i on i.service_order_id = s.id
     where s.delivery_order_id = ${a.orderId} and s.status = 'READY'
     order by s.number
     for update of s`;
  if (rows.length === 0) return [];
  const byProduct = new Map<string, { id: string; returned: number }[]>();
  for (const r of rows) byProduct.set(r.product_id, [...(byProduct.get(r.product_id) ?? []), { id: r.id, returned: r.returned }]);
  for (const [productId, list] of byProduct) {
    const split = distributeDelivered(list, a.delivered.get(productId) ?? 0);
    for (const [soId, q] of split) {
      await tx`update public.linen_service_order_items set delivered = ${q} where service_order_id = ${soId} and product_id = ${productId}`;
    }
  }
  const ids = [...new Set(rows.map((r) => r.id))];
  for (const id of ids) {
    serviceOrderStateMachine.assertTransition('READY', 'DELIVERED');
    await tx`update public.linen_service_orders set status = 'DELIVERED', delivered_at = now(), delivery_operation_id = ${a.operationId} where id = ${id}`;
    await event(tx, actor, id, 'READY', 'DELIVERED');
  }
  return ids;
}

// -----------------------------------------------------------------------------
// Lavanderia: OS pronta (conferência da saída)
// -----------------------------------------------------------------------------

export const readySchema = z.strictObject({
  items: z.array(z.strictObject({ productId: z.uuid(), returned: z.number().int().min(0).max(100000) })).min(1).max(30),
  divergenceNote: z.string().trim().max(1000).nullable().optional().transform((v) => v || null),
});

interface SoRow {
  id: string;
  number: string;
  customer_id: string;
  customer_name: string | null;
  status: ServiceOrderStatus;
  collected_at: Date;
  ready_at: Date | null;
  delivered_at: Date | null;
  delivery_order_id: string | null;
  delivery_order_number: string | null;
  delivery_order_status: string | null;
  notes: string | null;
  divergence_note: string | null;
  status_reason: string | null;
}

const SO_SELECT = `
  s.id, s.number::text as number, s.customer_id, coalesce(c.trade_name, c.legal_name) as customer_name, s.status, s.collected_at,
  s.ready_at, s.delivered_at, s.delivery_order_id, o.number::text as delivery_order_number, o.status as delivery_order_status,
  s.notes, s.divergence_note, s.status_reason`;
const SO_FROM = `
  from public.linen_service_orders s
  left join public.customers c on c.id = s.customer_id
  left join public.orders o on o.id = s.delivery_order_id`;

async function lockServiceOrder(tx: Tx, id: string): Promise<SoRow> {
  await tx`select 1 from public.linen_service_orders where id = ${id} and organization_id = app.current_org_id() for update`;
  const [s] = await tx.unsafe<SoRow[]>(`select ${SO_SELECT} ${SO_FROM} where s.id = $1 and s.organization_id = app.current_org_id()`, [id]);
  if (!s) throw new NotFoundError('Ordem de serviço não encontrada.');
  return s;
}

async function soItems(tx: Tx, id: string) {
  return tx<{ product_id: string; name: string; collected: number; damaged_on_arrival: number; returned: number | null; delivered: number | null }[]>`
    select i.product_id, p.name, i.collected, i.damaged_on_arrival, i.returned, i.delivered
      from public.linen_service_order_items i join public.products p on p.id = i.product_id
     where i.service_order_id = ${id} order by p.name`;
}

/** Saiu da lavanderia: confere as peças; falta vira ocorrência (a roupa é do cliente). */
export async function markServiceOrderReady(actor: UserActor, id: string, input: z.infer<typeof readySchema>) {
  authorize(actor, 'laundry.manage');
  const alerts: Alert[] = [];
  const result = await withActorTransaction(toDbContext(actor), async (tx) => {
    const s = await lockServiceOrder(tx, id);
    if (s.status === 'READY') return { status: s.status, replayed: true, incidents: [] as string[] };
    serviceOrderStateMachine.assertTransition(s.status, 'READY');
    const items = await soItems(tx, id);
    const byId = new Map(input.items.map((i) => [i.productId, i.returned]));
    if (byId.size !== input.items.length) throw new ValidationError('Produto repetido.');
    if (items.length !== byId.size || items.some((i) => !byId.has(i.product_id))) throw new ValidationError('Informe todas as peças da OS.');
    const check = readyDivergences(
      items.map((i) => ({ name: i.name, collected: i.collected, returned: byId.get(i.product_id)! })),
      input.divergenceNote,
    );
    for (const i of items) {
      await tx`update public.linen_service_order_items set returned = ${byId.get(i.product_id)!} where service_order_id = ${id} and product_id = ${i.product_id}`;
    }
    await tx`update public.linen_service_orders set status = 'READY', ready_at = now(), divergence_note = ${input.divergenceNote} where id = ${id}`;
    await event(tx, actor, id, s.status, 'READY', input.divergenceNote);

    const incidents: string[] = [];
    const label = formatServiceOrderNumber(s.number);
    for (const l of check.lines) {
      authorize(actor, 'incident.report');
      const productId = items.find((i) => i.name === l.name)!.product_id;
      const description = `${label}: ${l.name} coletadas ${l.collected}, saíram da lavanderia ${l.returned}. Faltam ${l.missing} peça(s) do cliente. ${input.divergenceNote ?? ''}`.trim();
      const inc = await createIncidentRow(tx, actor, {
        type: 'QUANTITY_DIVERGENCE', source: 'STAFF', description, customerId: s.customer_id, productId, quantity: l.missing,
        details: { stage: 'SERVICE', service_order_id: id, expected: l.collected, actual: l.returned },
      });
      incidents.push(inc.id);
      alerts.push({ ...inc, type: 'QUANTITY_DIVERGENCE', title: description });
    }
    await recordAudit(tx, actor, actor.organizationId, { action: 'linen.ready', entityType: 'linen_service_order', entityId: id, after: { items: input.items, missing: check.missing, incidents } });
    await recordOutboxEvent(tx, {
      organizationId: actor.organizationId,
      eventType: 'LinenReady',
      aggregateType: 'linen_service_order',
      aggregateId: id,
      payload: { service_order_id: id, number: s.number, customer_id: s.customer_id, missing: check.missing },
      idempotencyKey: `LinenReady:${id}`,
    });
    return { status: 'READY' as const, replayed: false, incidents };
  });
  for (const a of alerts) await openIncidentAlert(actor.organizationId, a);
  return result;
}

export const cancelServiceOrderSchema = z.strictObject({ reason: z.string().trim().min(5, 'Informe o motivo (mínimo 5 caracteres).').max(500) });

/** Só antes de lavar (ex.: coleta lançada no cliente errado). Nada é apagado. */
export async function cancelServiceOrder(actor: UserActor, id: string, input: z.infer<typeof cancelServiceOrderSchema>) {
  authorize(actor, 'laundry.manage');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const s = await lockServiceOrder(tx, id);
    if (s.status === 'CANCELLED') return { status: s.status, replayed: true };
    serviceOrderStateMachine.assertTransition(s.status, 'CANCELLED');
    await tx`update public.linen_service_orders set status = 'CANCELLED', status_reason = ${input.reason} where id = ${id}`;
    await event(tx, actor, id, s.status, 'CANCELLED', input.reason);
    await recordAudit(tx, actor, actor.organizationId, { action: 'linen.cancelled', entityType: 'linen_service_order', entityId: id, before: { status: s.status }, after: { status: 'CANCELLED' }, metadata: { reason: input.reason } });
    return { status: 'CANCELLED' as const, replayed: false };
  });
}

// -----------------------------------------------------------------------------
// Planejamento: gerar pedidos de entrega do enxoval pronto
// -----------------------------------------------------------------------------

export const generateDeliveriesSchema = z.strictObject({
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  serviceOrderIds: z.array(z.uuid()).max(200).optional(),
});

/**
 * OS prontas sem entrega ativa viram pedidos confirmados (um por cliente),
 * prontos para entrar numa rota. Pedido cancelado libera a OS de novo.
 */
export async function generateLinenDeliveries(actor: UserActor, input: z.infer<typeof generateDeliveriesSchema>, idempotencyKey: string) {
  authorize(actor, 'order.create');
  authorize(actor, 'order.update');
  if (input.scheduledDate < todayInSaoPaulo()) throw new BusinessRuleError('A data da entrega não pode ser no passado.');
  const { result } = await executeIdempotent(actor, { scope: 'linen.generate_deliveries', key: idempotencyKey, request: input }, async (tx) => {
    const ready = await tx<{ id: string; number: string; customer_id: string }[]>`
      select s.id, s.number::text as number, s.customer_id
        from public.linen_service_orders s left join public.orders o on o.id = s.delivery_order_id
       where s.organization_id = app.current_org_id() and s.status = 'READY'
         and (s.delivery_order_id is null or o.status = 'CANCELLED')
         and (${input.serviceOrderIds ?? null}::uuid[] is null or s.id = any (${input.serviceOrderIds ?? null}::uuid[]))
       order by s.customer_id, s.number
       for update of s`;
    const byCustomer = new Map<string, { id: string; number: string; customer_id: string }[]>();
    for (const r of ready) byCustomer.set(r.customer_id, [...(byCustomer.get(r.customer_id) ?? []), r]);
    const created: { orderId: string; number: string; customerId: string; serviceOrders: string[] }[] = [];
    for (const [customerId, list] of byCustomer) {
      const ids = list.map((l) => l.id);
      const totals = await tx<{ product_id: string; q: number }[]>`
        select product_id, sum(returned)::int as q from public.linen_service_order_items
         where service_order_id = any (${ids}::uuid[]) and returned > 0 group by product_id`;
      if (totals.length === 0) continue;
      const labels = list.map((l) => formatServiceOrderNumber(l.number)).join(', ');
      const order = await createLinenDeliveryOrder(tx, actor, {
        customerId,
        scheduledDate: input.scheduledDate,
        items: totals.map((t) => ({ productId: t.product_id, quantity: t.q })),
        notes: `Entrega de enxoval: ${labels}`.slice(0, 1000),
      });
      await tx`update public.linen_service_orders set delivery_order_id = ${order.id} where id = any (${ids}::uuid[])`;
      for (const id of ids) await event(tx, actor, id, 'READY', 'READY', `Entrega programada no pedido ${formatOrderNumber(order.number)}`);
      created.push({ orderId: order.id, number: formatOrderNumber(order.number), customerId, serviceOrders: ids });
    }
    return { created };
  });
  return result;
}

// -----------------------------------------------------------------------------
// Consultas
// -----------------------------------------------------------------------------

export const serviceOrderListQuerySchema = z.strictObject({
  status: z.enum(SERVICE_ORDER_STATUSES).optional(),
  customerId: z.uuid().optional(),
  /** Prontas sem entrega programada (para o planejamento). */
  awaitingDelivery: z.enum(['true']).optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
});

function canRead(actor: UserActor) {
  if (!(['laundry.read', 'order.read', 'contract.read'] as const).some((p) => hasPermission(actor, p))) authorize(actor, 'laundry.read');
}

function soDto(s: SoRow) {
  return {
    id: s.id,
    number: formatServiceOrderNumber(s.number),
    customerId: s.customer_id,
    customerName: s.customer_name,
    status: s.status,
    collectedAt: s.collected_at.toISOString(),
    readyAt: s.ready_at?.toISOString() ?? null,
    deliveredAt: s.delivered_at?.toISOString() ?? null,
    deliveryOrder: s.delivery_order_id && s.delivery_order_status !== 'CANCELLED'
      ? { id: s.delivery_order_id, number: formatOrderNumber(s.delivery_order_number!), status: s.delivery_order_status }
      : null,
    notes: s.notes,
    divergenceNote: s.divergence_note,
    statusReason: s.status_reason,
  };
}

export async function listServiceOrders(actor: UserActor, q: z.infer<typeof serviceOrderListQuerySchema>) {
  canRead(actor);
  const pageSize = 30;
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const rows = await tx.unsafe<(SoRow & { pieces: number })[]>(
      `select ${SO_SELECT},
              coalesce((select sum(i.collected) from public.linen_service_order_items i where i.service_order_id = s.id), 0)::int as pieces
         ${SO_FROM}
        where s.organization_id = app.current_org_id()
          and ($1::text is null or s.status = $1)
          and ($2::uuid is null or s.customer_id = $2)
          and ($3::boolean is not true or (s.status = 'READY' and (s.delivery_order_id is null or o.status = 'CANCELLED')))
        order by case s.status when 'COLLECTED' then 0 when 'READY' then 1 else 2 end, s.collected_at desc
        limit ${pageSize + 1} offset ${(q.page - 1) * pageSize}`,
      [q.status ?? null, q.customerId ?? null, q.awaitingDelivery === 'true'],
    );
    const ids = rows.slice(0, pageSize).map((r) => r.id);
    const items = ids.length
      ? await tx<{ service_order_id: string; product_id: string; name: string; collected: number; returned: number | null }[]>`
          select i.service_order_id, i.product_id, p.name, i.collected, i.returned
            from public.linen_service_order_items i join public.products p on p.id = i.product_id
           where i.service_order_id = any (${ids}::uuid[]) order by p.name`
      : [];
    return {
      items: rows.slice(0, pageSize).map((r) => ({
        ...soDto(r),
        pieces: r.pieces,
        lines: items.filter((i) => i.service_order_id === r.id).map((i) => ({ productId: i.product_id, name: i.name, collected: i.collected, returned: i.returned })),
      })),
      hasMore: rows.length > pageSize,
    };
  });
}

export async function getServiceOrderDetail(actor: UserActor, id: string) {
  canRead(actor);
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const [s] = await tx.unsafe<SoRow[]>(`select ${SO_SELECT} ${SO_FROM} where s.id = $1 and s.organization_id = app.current_org_id()`, [id]);
    if (!s) throw new NotFoundError('Ordem de serviço não encontrada.');
    const items = await soItems(tx, id);
    const events = await tx<{ id: string; from_status: string | null; to_status: string; note: string | null; actor_name: string | null; created_at: Date }[]>`
      select e.id, e.from_status, e.to_status, e.note, p.full_name as actor_name, e.created_at
        from public.linen_service_order_events e left join public.profiles p on p.id = e.actor_id and e.actor_type = 'USER'
       where e.service_order_id = ${id} order by e.created_at, e.id`;
    const manage = hasPermission(actor, 'laundry.manage');
    return {
      serviceOrder: soDto(s),
      items: items.map((i) => ({ productId: i.product_id, name: i.name, collected: i.collected, damagedOnArrival: i.damaged_on_arrival, returned: i.returned, delivered: i.delivered })),
      events: events.map((e) => ({ id: e.id, from: e.from_status, to: e.to_status, note: e.note, actorName: e.actor_name, at: e.created_at.toISOString() })),
      actions: { ready: manage && s.status === 'COLLECTED', cancel: manage && s.status === 'COLLECTED' },
    };
  });
}

/** Peças higienizadas por produto no mês (rol da coleta) — base da cobrança por peça. */
export async function linenUsage(tx: Tx, customerId: string, from: string, to: string): Promise<Record<string, number>> {
  const rows = await tx<{ product_id: string; q: number }[]>`
    select i.product_id, sum(i.collected)::int as q
      from public.linen_service_orders s join public.linen_service_order_items i on i.service_order_id = s.id
     where s.customer_id = ${customerId} and s.status <> 'CANCELLED'
       and (s.collected_at at time zone 'America/Sao_Paulo')::date between ${from}::date and ${to}::date
     group by i.product_id`;
  return Object.fromEntries(rows.map((r) => [r.product_id, r.q]));
}
