import 'server-only';
import { z } from 'zod';
import { toDbContext, type UserActor } from '@/server/auth/actor';
import { authorize, hasPermission } from '@/server/authz/authorize';
import { BusinessRuleError, NotFoundError, ValidationError } from '@/server/core/errors';
import type { Tx } from '@/server/db/client';
import { withActorTransaction } from '@/server/db/transaction';
import { linkAttachments, listAttachmentIds } from '@/server/modules/attachments/attachments.service';
import { recordAudit } from '@/server/modules/audit/audit.service';
import { DAMAGE_CLASSES, STOP_PROBLEM_TYPES, type IncidentType } from '@/server/modules/incidents/incidents.domain';
import { createIncidentRow, openIncidentAlert } from '@/server/modules/incidents/incidents.service';
import type { MovementInput } from '@/server/modules/inventory/inventory.domain';
import { recordMovements } from '@/server/modules/inventory/inventory.service';
import { formatOrderNumber } from '@/server/modules/orders/orders.domain';
import { applyTransition } from '@/server/modules/orders/orders.service';
import { readSettings } from '@/server/modules/organizations/organization-settings';
import { recordOutboxEvent } from '@/server/modules/outbox/outbox.service';
import { geoSchema } from './geo.schema';
import { stopStateMachine, type StopStatus } from './routes.domain';
import { findRoute, insertRouteEvent, type GeoPoint, type RouteRow } from './routes.repository';

/**
 * Atendimento da parada. Tudo numa transação: valida pedido e parada →
 * registra operação e itens → movimentos (coleta, entrega) → ocorrências de
 * divergência/dano → status → outbox. Nada é corrigido em silêncio.
 */

interface StopRow {
  id: string;
  route_id: string;
  order_id: string;
  customer_id: string;
  status: StopStatus;
  sequence: number;
}

/** Motorista da rota, ou equipe com route.manage (registro em nome do motorista). */
async function loadStopForOperation(tx: Tx, actor: UserActor, stopId: string): Promise<{ stop: StopRow; route: RouteRow }> {
  const [stop] = await tx<StopRow[]>`
    select id, route_id, order_id, customer_id, status, sequence from public.route_stops where id = ${stopId} and organization_id = app.current_org_id()`;
  if (!stop) throw new NotFoundError('Parada não encontrada.');
  const route = await findRoute(tx, stop.route_id, true);
  if (!route) throw new NotFoundError('Parada não encontrada.');
  if (!hasPermission(actor, 'route.manage')) {
    const [d] = await tx<{ id: string | null }[]>`select app.current_driver_id() as id`;
    if (!d?.id || d.id !== route.driver_id) throw new NotFoundError('Parada não encontrada.');
  }
  const [locked] = await tx<{ status: StopStatus }[]>`select status from public.route_stops where id = ${stopId} for update`;
  return { stop: { ...stop, status: locked!.status }, route };
}

async function dispatchedByProduct(tx: Tx, orderId: string): Promise<Map<string, number>> {
  const rows = await tx<{ product_id: string; q: number }[]>`
    select product_id, sum(quantity)::int as q from public.towel_movements
     where order_id = ${orderId} and movement_type = 'DELIVERY_DISPATCH' and to_state = 'IN_ROUTE' group by 1`;
  return new Map(rows.map((r) => [r.product_id, r.q]));
}

async function balance(tx: Tx, customerId: string, productId: string): Promise<number> {
  const [row] = await tx<{ q: number | null }[]>`select app.customer_product_balance(${customerId}, ${productId}) as q`;
  return row?.q ?? 0;
}

interface FormLine {
  productId: string;
  name: string;
  plannedDelivery: number;
  loaded: number;
  expectedCollection: number;
  customerBalance: number;
}

/** Linhas do atendimento: produtos do pedido + produtos que o cliente tem em posse. */
async function buildLines(tx: Tx, orderId: string, orderType: string, customerId: string): Promise<FormLine[]> {
  const items = await tx<{ product_id: string; name: string; delivery_quantity: number; collection_quantity: number }[]>`
    select i.product_id, p.name, i.delivery_quantity, i.collection_quantity
      from public.order_items i join public.products p on p.id = i.product_id where i.order_id = ${orderId} order by p.name`;
  const held = await tx<{ product_id: string; name: string }[]>`
    select p.id as product_id, p.name from public.products p
     where p.organization_id = app.current_org_id() and app.customer_product_balance(${customerId}, p.id) > 0 order by p.name`;
  const loaded = await dispatchedByProduct(tx, orderId);
  const lines: FormLine[] = [];
  const collects = orderType !== 'DELIVERY';
  // Pedido com quantidade de coleta definida: espera-se exatamente isso. Sem quantidade: recolher tudo o que o cliente tem.
  const explicit = items.some((i) => i.collection_quantity > 0);
  for (const i of items) {
    const bal = await balance(tx, customerId, i.product_id);
    lines.push({
      productId: i.product_id,
      name: i.name,
      plannedDelivery: i.delivery_quantity,
      loaded: loaded.get(i.product_id) ?? 0,
      // Coleta esperada: o que o pedido pede; sem quantidade no pedido, o saldo do cliente.
      expectedCollection: !collects ? 0 : explicit ? Math.min(i.collection_quantity, bal) : bal,
      customerBalance: bal,
    });
  }
  for (const h of held) {
    if (lines.some((l) => l.productId === h.product_id)) continue;
    const bal = await balance(tx, customerId, h.product_id);
    lines.push({ productId: h.product_id, name: h.name, plannedDelivery: 0, loaded: 0, expectedCollection: collects && !explicit ? bal : 0, customerBalance: bal });
  }
  return lines;
}

export async function getStopServiceForm(actor: UserActor, stopId: string) {
  authorize(actor, 'operation.execute');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const { stop, route } = await loadStopForOperation(tx, actor, stopId);
    const [o] = await tx<{ number: string; order_type: string; status: string; customer_name: string | null; notes: string | null }[]>`
      select o.number::text as number, o.order_type, o.status, coalesce(c.trade_name, c.legal_name) as customer_name, o.notes
        from public.orders o left join public.customers c on c.id = o.customer_id where o.id = ${stop.order_id}`;
    const settings = await readSettings(tx, actor.organizationId);
    return {
      stop: { id: stop.id, status: stop.status, sequence: stop.sequence },
      route: { id: route.id, status: route.status },
      order: { id: stop.order_id, number: formatOrderNumber(o!.number), type: o!.order_type, status: o!.status, customerName: o!.customer_name, notes: o!.notes },
      lines: await buildLines(tx, stop.order_id, o!.order_type, stop.customer_id),
      requireProofPhoto: settings.operations.requireProofPhoto,
      canOperate: route.status === 'IN_PROGRESS' && ['ON_THE_WAY', 'ARRIVED', 'IN_SERVICE'].includes(stop.status) && o!.status === 'IN_TRANSIT',
    };
  });
}

export const completeStopSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        productId: z.uuid(),
        delivered: z.number().int().min(0).max(100000),
        collected: z.number().int().min(0).max(100000),
        damaged: z.number().int().min(0).max(100000).default(0),
        damageClass: z.enum(DAMAGE_CLASSES).nullable().optional(),
      }),
    )
    .min(1)
    .max(30),
  recipientName: z
    .string()
    .trim()
    .max(150)
    .nullable()
    .optional()
    .transform((v) => v || null)
    .refine((v) => v === null || v.length >= 2, 'Informe o nome de quem recebeu.'),
  notes: z.string().trim().max(1000).nullable().optional().transform((v) => v || null),
  attachmentIds: z.array(z.uuid()).max(5).default([]),
  geo: geoSchema,
});

/** Leva a parada até IN_SERVICE passando pelos estados intermediários (cada passo registrado). */
async function advanceToService(tx: Tx, actor: UserActor, routeId: string, stop: StopRow, geo: GeoPoint | null) {
  const path: StopStatus[] = stop.status === 'ON_THE_WAY' ? ['ARRIVED', 'IN_SERVICE'] : stop.status === 'ARRIVED' ? ['IN_SERVICE'] : [];
  let from = stop.status;
  for (const to of path) {
    stopStateMachine.assertTransition(from, to);
    await tx`update public.route_stops set status = ${to}, arrived_at = case when ${to} = 'ARRIVED' then now() else arrived_at end where id = ${stop.id}`;
    await insertRouteEvent(tx, actor, { routeId, stopId: stop.id, type: 'STOP_STATUS', from, to, geo });
    from = to;
  }
}

export async function completeStop(actor: UserActor, stopId: string, input: z.infer<typeof completeStopSchema>) {
  authorize(actor, 'operation.execute');
  const alerts: { id: string; number: string; type: IncidentType; title: string }[] = [];
  const result = await withActorTransaction(toDbContext(actor), async (tx) => {
    const { stop, route } = await loadStopForOperation(tx, actor, stopId);
    // Retry/duplo toque: a parada já atendida devolve o mesmo registro.
    const [done] = await tx<{ id: string }[]>`select id from public.stop_operations where route_stop_id = ${stopId}`;
    if (done) return { operationId: done.id, replayed: true, incidents: [] as string[] };
    if (route.status !== 'IN_PROGRESS') throw new BusinessRuleError('A rota não está em andamento.');
    if (!['ON_THE_WAY', 'ARRIVED', 'IN_SERVICE'].includes(stop.status)) throw new BusinessRuleError('Esta parada não está em atendimento.');
    const [order] = await tx<{ status: string; order_type: string; number: string }[]>`
      select status, order_type, number::text as number from public.orders where id = ${stop.order_id} for update`;
    if (order?.status !== 'IN_TRANSIT') throw new BusinessRuleError('O pedido desta parada não está em trânsito.');

    const lines = await buildLines(tx, stop.order_id, order.order_type, stop.customer_id);
    const byId = new Map(lines.map((l) => [l.productId, l]));
    const seen = new Set<string>();
    for (const it of input.items) {
      const l = byId.get(it.productId);
      if (!l) throw new ValidationError('Produto fora do pedido e sem saldo com o cliente.', [{ path: 'items', message: it.productId }]);
      if (seen.has(it.productId)) throw new ValidationError('Produto repetido.');
      seen.add(it.productId);
      if (it.delivered > l.loaded) throw new BusinessRuleError(`${l.name}: só ${l.loaded} saíram no veículo para este pedido.`);
      if (it.collected > l.customerBalance) {
        throw new BusinessRuleError(`${l.name}: o cliente tem ${l.customerBalance} no sistema. Colete no máximo isso e registre uma ocorrência para o excedente.`);
      }
      if (it.damaged > it.collected) throw new BusinessRuleError(`${l.name}: danificadas não podem passar das coletadas.`);
      if (it.damaged > 0 && !it.damageClass) throw new ValidationError(`${l.name}: informe o tipo de dano.`, [{ path: 'damageClass', message: 'obrigatório' }]);
    }
    // Produto previsto e não informado conta como zero (vira divergência, não some).
    const items = lines.map((l) => {
      const it = input.items.find((x) => x.productId === l.productId);
      return { line: l, delivered: it?.delivered ?? 0, collected: it?.collected ?? 0, damaged: it?.damaged ?? 0, damageClass: it?.damageClass ?? null };
    });
    const movedAny = items.some((i) => i.delivered > 0 || i.collected > 0);
    if (movedAny && !input.recipientName) throw new ValidationError('Informe o nome de quem recebeu.', [{ path: 'recipientName', message: 'obrigatório' }]);
    const settings = await readSettings(tx, actor.organizationId);
    if (settings.operations.requireProofPhoto && movedAny && input.attachmentIds.length === 0) {
      throw new ValidationError('Foto de comprovação obrigatória.', [{ path: 'attachmentIds', message: 'obrigatório' }]);
    }

    await advanceToService(tx, actor, route.id, stop, input.geo);
    const [op] = await tx<{ id: string }[]>`
      insert into public.stop_operations (organization_id, route_id, route_stop_id, order_id, customer_id, driver_id, recipient_name, notes,
                                          latitude, longitude, accuracy_meters, geolocation_status, actor_type, actor_id)
      values (${actor.organizationId}, ${route.id}, ${stopId}, ${stop.order_id}, ${stop.customer_id}, ${route.driver_id}, ${input.recipientName},
              ${input.notes}, ${input.geo?.latitude ?? null}, ${input.geo?.longitude ?? null},
              ${input.geo?.accuracy === null || input.geo?.accuracy === undefined ? null : Math.round(input.geo.accuracy)},
              ${input.geo ? 'CAPTURED' : 'UNAVAILABLE'}, 'USER', ${actor.userId})
      returning id`;
    const operationId = op!.id;

    const base = { customerId: stop.customer_id, orderId: stop.order_id, routeId: route.id, routeStopId: stopId, driverId: route.driver_id };
    const movements: MovementInput[] = [];
    for (const i of items) {
      const l = i.line;
      await tx`
        insert into public.stop_operation_items (organization_id, operation_id, product_id, planned_delivery, loaded, delivered,
                                                 expected_collection, customer_balance_before, collected, damaged)
        values (${actor.organizationId}, ${operationId}, ${l.productId}, ${l.plannedDelivery}, ${l.loaded}, ${i.delivered},
                ${l.expectedCollection}, ${l.customerBalance}, ${i.collected}, ${i.damaged})`;
      const key = (k: string) => `stopop:${stopId}:${l.productId}:${k}`;
      // Coleta antes da entrega: o saldo coletável é o que o cliente tinha ao chegarmos.
      if (i.collected > 0) movements.push({ ...base, productId: l.productId, type: 'COLLECTION', quantity: i.collected, from: 'WITH_CUSTOMER', to: 'AWAITING_LAUNDRY', idempotencyKey: key('collect') });
      if (i.delivered > 0) movements.push({ ...base, productId: l.productId, type: 'DELIVERY', quantity: i.delivered, from: 'IN_ROUTE', to: 'WITH_CUSTOMER', idempotencyKey: key('deliver') });
    }
    if (movements.length) await recordMovements(tx, actor, movements);

    const incidents: string[] = [];
    const open = async (type: IncidentType, productId: string, quantity: number, description: string, details: Record<string, unknown>, damageClass: string | null = null) => {
      const inc = await createIncidentRow(tx, actor, {
        type, source: 'DRIVER', description, customerId: stop.customer_id, orderId: stop.order_id, routeId: route.id,
        routeStopId: stopId, operationId, productId, quantity, details, damageClass,
      });
      incidents.push(inc.id);
      alerts.push({ ...inc, type, title: description });
    };
    for (const i of items) {
      const l = i.line;
      if (i.collected !== l.expectedCollection && (l.expectedCollection > 0 || i.collected > 0)) {
        const missing = l.expectedCollection - i.collected;
        await open(
          'QUANTITY_DIVERGENCE',
          l.productId,
          Math.abs(missing),
          missing > 0
            ? `Coleta de ${l.name}: esperado ${l.expectedCollection}, coletado ${i.collected}. ${missing} seguem com o cliente.`
            : `Coleta de ${l.name}: esperado ${l.expectedCollection}, coletado ${i.collected} (${-missing} a mais).`,
          { stage: 'COLLECTION', expected: l.expectedCollection, actual: i.collected, customer_balance_before: l.customerBalance },
        );
      }
      if (i.delivered < l.plannedDelivery) {
        const diff = l.plannedDelivery - i.delivered;
        await open('QUANTITY_DIVERGENCE', l.productId, diff, `Entrega de ${l.name}: previsto ${l.plannedDelivery}, entregue ${i.delivered}. ${diff} voltam com o motorista.`, {
          stage: 'DELIVERY', expected: l.plannedDelivery, actual: i.delivered,
        });
      }
      if (i.damaged > 0) {
        await open('DAMAGED', l.productId, i.damaged, `${i.damaged} toalha(s) de ${l.name} coletadas com dano.`, { location: 'AWAITING_LAUNDRY' }, i.damageClass);
      }
    }

    await linkAttachments(tx, actor, input.attachmentIds, 'stop_operation', operationId);
    await tx`update public.route_stops set status = 'COMPLETED', completed_at = now() where id = ${stopId}`;
    await insertRouteEvent(tx, actor, { routeId: route.id, stopId, type: 'STOP_STATUS', from: 'IN_SERVICE', to: 'COMPLETED', geo: input.geo, metadata: { operation_id: operationId, incidents: incidents.length } });
    await applyTransition(tx, actor, stop.order_id, { to: 'DELIVERED', overrideStock: false, windowStart: null, windowEnd: null });
    const totals = items.reduce((a, i) => ({ delivered: a.delivered + i.delivered, collected: a.collected + i.collected }), { delivered: 0, collected: 0 });
    await recordAudit(tx, actor, actor.organizationId, { action: 'route_stop.completed', entityType: 'route_stop', entityId: stopId, after: { operation_id: operationId, ...totals, incidents } });
    await recordOutboxEvent(tx, {
      organizationId: actor.organizationId,
      eventType: 'DeliveryCompleted',
      aggregateType: 'order',
      aggregateId: stop.order_id,
      payload: { order_id: stop.order_id, number: order.number, customer_id: stop.customer_id, route_id: route.id, stop_id: stopId, operation_id: operationId, ...totals, recipient_name: input.recipientName, incidents },
      idempotencyKey: `DeliveryCompleted:${stopId}`,
    });
    return { operationId, replayed: false, incidents };
  });
  for (const a of alerts) await openIncidentAlert(actor.organizationId, a);
  return result;
}

export const stopProblemSchema = z.strictObject({
  type: z.enum(STOP_PROBLEM_TYPES),
  description: z.string().trim().min(3).max(1000),
  attachmentIds: z.array(z.uuid()).max(5).default([]),
  geo: geoSchema,
});

const PROBLEM_LABEL: Record<(typeof STOP_PROBLEM_TYPES)[number], string> = {
  CUSTOMER_REFUSED: 'Cliente recusou',
  CUSTOMER_CLOSED: 'Estabelecimento fechado',
  ADDRESS_PROBLEM: 'Problema no endereço',
  OTHER: 'Outro problema',
};

/**
 * Parada não atendida: ocorrência + parada FAILED (ou SKIPPED se nem saiu) +
 * pedido em DELIVERY_PROBLEM. As toalhas seguem no veículo e voltam ao
 * estoque quando a rota é finalizada.
 */
export async function reportStopProblem(actor: UserActor, stopId: string, input: z.infer<typeof stopProblemSchema>) {
  authorize(actor, 'incident.report');
  let alert: { id: string; number: string; type: IncidentType; title: string } | null = null;
  const result = await withActorTransaction(toDbContext(actor), async (tx) => {
    const { stop, route } = await loadStopForOperation(tx, actor, stopId);
    if (route.status !== 'IN_PROGRESS') throw new BusinessRuleError('A rota não está em andamento.');
    const to: StopStatus = stop.status === 'PENDING' ? 'SKIPPED' : 'FAILED';
    stopStateMachine.assertTransition(stop.status, to);
    const title = `${PROBLEM_LABEL[input.type]}: ${input.description}`;
    const inc = await createIncidentRow(tx, actor, {
      type: input.type, source: 'DRIVER', description: title, customerId: stop.customer_id, orderId: stop.order_id,
      routeId: route.id, routeStopId: stopId, details: { stop_status: to },
    });
    await linkAttachments(tx, actor, input.attachmentIds, 'incident', inc.id);
    await tx`update public.route_stops set status = ${to}, status_reason = ${title.slice(0, 500)}, completed_at = now() where id = ${stopId}`;
    await insertRouteEvent(tx, actor, { routeId: route.id, stopId, type: 'STOP_STATUS', from: stop.status, to, reason: title.slice(0, 500), geo: input.geo, metadata: { incident_id: inc.id } });
    await applyTransition(tx, actor, stop.order_id, { to: 'DELIVERY_PROBLEM', reason: title.slice(0, 500), overrideStock: false, windowStart: null, windowEnd: null });
    alert = { ...inc, type: input.type, title };
    return { incidentId: inc.id, stopStatus: to };
  });
  if (alert) await openIncidentAlert(actor.organizationId, alert);
  return result;
}

/** Prova da operação para a equipe (rota, pedido ou cliente). */
export async function listOperations(actor: UserActor, q: { date?: string; customerId?: string; routeId?: string; kind?: 'delivery' | 'collection'; page: number }) {
  authorize(actor, 'route.read');
  const pageSize = 30;
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const rows = await tx<{
      id: string; route_id: string; route_stop_id: string; order_id: string; order_number: string; customer_id: string; customer_name: string | null;
      driver_name: string | null; recipient_name: string | null; notes: string | null; geolocation_status: string; latitude: number | null; longitude: number | null;
      occurred_at: Date; delivered: number; planned: number; collected: number; expected: number; damaged: number; incidents: number;
    }[]>`
      select op.id, op.route_id, op.route_stop_id, op.order_id, o.number::text as order_number, op.customer_id,
             coalesce(c.trade_name, c.legal_name) as customer_name, d.full_name as driver_name, op.recipient_name, op.notes, op.geolocation_status,
             op.latitude::float8 as latitude, op.longitude::float8 as longitude, op.occurred_at,
             coalesce(sum(it.delivered), 0)::int as delivered, coalesce(sum(it.planned_delivery), 0)::int as planned,
             coalesce(sum(it.collected), 0)::int as collected, coalesce(sum(it.expected_collection), 0)::int as expected,
             coalesce(sum(it.damaged), 0)::int as damaged,
             (select count(*) from public.incidents i where i.operation_id = op.id)::int as incidents
        from public.stop_operations op
        join public.orders o on o.id = op.order_id
        left join public.customers c on c.id = op.customer_id
        left join public.drivers d on d.id = op.driver_id
        left join public.stop_operation_items it on it.operation_id = op.id
       where op.organization_id = app.current_org_id()
         and (${q.date ?? null}::date is null or (op.occurred_at at time zone 'America/Sao_Paulo')::date = ${q.date ?? null}::date)
         and (${q.customerId ?? null}::uuid is null or op.customer_id = ${q.customerId ?? null}::uuid)
         and (${q.routeId ?? null}::uuid is null or op.route_id = ${q.routeId ?? null}::uuid)
       group by op.id, o.number, c.trade_name, c.legal_name, d.full_name
      having (${q.kind ?? null}::text is null
              or (${q.kind ?? null} = 'delivery' and sum(it.delivered) > 0)
              or (${q.kind ?? null} = 'collection' and sum(it.collected) > 0))
       order by op.occurred_at desc
       limit ${pageSize + 1} offset ${(q.page - 1) * pageSize}`;
    const items = [];
    for (const r of rows.slice(0, pageSize)) {
      items.push({
        id: r.id,
        routeId: r.route_id,
        stopId: r.route_stop_id,
        orderId: r.order_id,
        orderNumber: formatOrderNumber(r.order_number),
        customerId: r.customer_id,
        customerName: r.customer_name,
        driverName: r.driver_name,
        recipientName: r.recipient_name,
        notes: r.notes,
        geolocation: r.geolocation_status === 'CAPTURED' ? { lat: r.latitude, lng: r.longitude } : null,
        occurredAt: r.occurred_at.toISOString(),
        delivered: r.delivered,
        planned: r.planned,
        collected: r.collected,
        expected: r.expected,
        damaged: r.damaged,
        incidents: r.incidents,
        attachmentIds: await listAttachmentIds(tx, 'stop_operation', r.id),
      });
    }
    return { items, hasMore: rows.length > pageSize };
  });
}
