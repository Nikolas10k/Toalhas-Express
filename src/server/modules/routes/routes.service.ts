import 'server-only';
import { z } from 'zod';
import { toDbContext, type UserActor } from '@/server/auth/actor';
import { authorize } from '@/server/authz/authorize';
import { BusinessRuleError, NotFoundError, ProviderError, ValidationError } from '@/server/core/errors';
import { logger } from '@/server/core/logger';
import type { Tx } from '@/server/db/client';
import { withActorTransaction } from '@/server/db/transaction';
import { recordAudit } from '@/server/modules/audit/audit.service';
import { getMapsProvider } from '@/server/modules/customers/geocoding.service';
import { executeIdempotent } from '@/server/modules/idempotency/idempotency.service';
import { formatOrderNumber, todayInSaoPaulo } from '@/server/modules/orders/orders.domain';
import { applyTransition } from '@/server/modules/orders/orders.service';
import { readSettings } from '@/server/modules/organizations/organization-settings';
import { recordOutboxEvent } from '@/server/modules/outbox/outbox.service';
import { MAX_OPTIMIZED_STOPS } from '@/server/providers/google-maps-provider';
import { assertCapacity, assertPermutation, routeStateMachine, straightLineTotal, type RouteStatus } from './routes.domain';
import { findRoute, insertRouteEvent, routeEvents, routeStops, stopItems, type RouteRow, type StopRow } from './routes.repository';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.');

/**
 * Pedidos que podem entrar numa rota: confirmados (estoque reservado) em
 * qualquer etapa até "pronto". Ao entrar, avançam as etapas que faltam
 * (CONFIRMED → PREPARING → READY → ROUTE_ASSIGNED), cada uma no histórico.
 */
const ROUTABLE_STATUSES = ['CONFIRMED', 'PREPARING', 'READY'] as const;
const STEPS_TO_READY: Record<string, ('PREPARING' | 'READY')[]> = { CONFIRMED: ['PREPARING', 'READY'], PREPARING: ['READY'], READY: [] };
const MAX_STOPS = 100;

// -----------------------------------------------------------------------------
// Consultas
// -----------------------------------------------------------------------------

export const routeListQuerySchema = z.strictObject({
  date: isoDate.optional(),
  status: z.enum(['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
  driverId: z.uuid().optional(),
});

export async function listRoutes(actor: UserActor, q: z.infer<typeof routeListQuerySchema>) {
  authorize(actor, 'route.read');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const rows = await tx<(RouteRow & { stops: number; open_stops: number; total_delivery: number; total_collection: number })[]>`
      select r.id, r.route_date::text as route_date, r.driver_id, d.full_name as driver_name, r.vehicle_id, v.plate as vehicle_plate,
             v.capacity as vehicle_capacity, r.status, r.distance_meters, r.duration_seconds, r.ordering, r.started_at, r.completed_at,
             (select count(*) from public.route_stops s where s.route_id = r.id)::int as stops,
             (select count(*) from public.route_stops s where s.route_id = r.id and s.status in ('PENDING', 'ON_THE_WAY', 'ARRIVED', 'IN_SERVICE'))::int as open_stops,
             coalesce((select sum(i.delivery_quantity) from public.route_stops s join public.order_items i on i.order_id = s.order_id where s.route_id = r.id), 0)::int as total_delivery,
             coalesce((select sum(i.collection_quantity) from public.route_stops s join public.order_items i on i.order_id = s.order_id where s.route_id = r.id), 0)::int as total_collection
        from public.routes r
        join public.drivers d on d.id = r.driver_id
        join public.vehicles v on v.id = r.vehicle_id
       where r.organization_id = app.current_org_id()
         and (${q.date ?? null}::date is null or r.route_date = ${q.date ?? null}::date)
         and (${q.status ?? null}::text is null or r.status = ${q.status ?? null})
         and (${q.driverId ?? null}::uuid is null or r.driver_id = ${q.driverId ?? null}::uuid)
       order by r.route_date desc, d.full_name
       limit 200`;
    return rows.map((r) => ({
      id: r.id,
      date: r.route_date,
      driverId: r.driver_id,
      driverName: r.driver_name,
      vehicleId: r.vehicle_id,
      vehiclePlate: r.vehicle_plate,
      vehicleCapacity: r.vehicle_capacity,
      status: r.status,
      distanceMeters: r.distance_meters,
      durationSeconds: r.duration_seconds,
      ordering: r.ordering,
      stops: r.stops,
      openStops: r.open_stops,
      totalDelivery: r.total_delivery,
      totalCollection: r.total_collection,
    }));
  });
}

function stopDto(s: StopRow, items: Awaited<ReturnType<typeof stopItems>>) {
  return {
    id: s.id,
    sequence: s.sequence,
    status: s.status,
    orderId: s.order_id,
    orderNumber: formatOrderNumber(s.order_number),
    orderStatus: s.order_status,
    orderType: s.order_type,
    customerId: s.customer_id,
    customerName: s.customer_name,
    address: s.address,
    latitude: s.latitude,
    longitude: s.longitude,
    windowStart: s.window_start,
    windowEnd: s.window_end,
    notes: s.notes,
    totalDelivery: s.total_delivery,
    totalCollection: s.total_collection,
    items: items
      .filter((i) => i.order_id === s.order_id)
      .map((i) => ({ productId: i.product_id, name: i.name, sku: i.sku, deliveryQuantity: i.delivery_quantity, collectionQuantity: i.collection_quantity })),
    statusReason: s.status_reason,
    arrivedAt: s.arrived_at?.toISOString() ?? null,
    completedAt: s.completed_at?.toISOString() ?? null,
  };
}

export async function getRouteDetail(actor: UserActor, id: string) {
  authorize(actor, 'route.read');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const r = await findRoute(tx, id);
    if (!r) throw new NotFoundError('Rota não encontrada.');
    const [stops, items, events, settings] = [await routeStops(tx, id), await stopItems(tx, id), await routeEvents(tx, id), await readSettings(tx, actor.organizationId)];
    const depot = settings.routes.depot;
    const points = stops.map((s) => (s.latitude !== null && s.longitude !== null ? { lat: s.latitude, lng: s.longitude } : null));
    const withDepot = depot ? [{ lat: depot.latitude, lng: depot.longitude }, ...points, { lat: depot.latitude, lng: depot.longitude }] : points;
    return {
      route: {
        id: r.id,
        date: r.route_date,
        status: r.status,
        driverId: r.driver_id,
        driverName: r.driver_name,
        vehicleId: r.vehicle_id,
        vehiclePlate: r.vehicle_plate,
        vehicleModel: r.vehicle_model,
        vehicleCapacity: r.vehicle_capacity,
        distanceMeters: r.distance_meters,
        durationSeconds: r.duration_seconds,
        ordering: r.ordering,
        optimizedAt: r.optimized_at?.toISOString() ?? null,
        notes: r.notes,
        statusReason: r.status_reason,
        startedAt: r.started_at?.toISOString() ?? null,
        completedAt: r.completed_at?.toISOString() ?? null,
      },
      depot,
      straightLineMeters: straightLineTotal(withDepot),
      missingLocation: points.filter((p) => p === null).length,
      totalDelivery: stops.reduce((a, s) => a + s.total_delivery, 0),
      totalCollection: stops.reduce((a, s) => a + s.total_collection, 0),
      stops: stops.map((s) => stopDto(s, items)),
      events: events.map((e) => ({
        id: e.id,
        stopId: e.route_stop_id,
        type: e.event_type,
        from: e.from_status,
        to: e.to_status,
        reason: e.reason,
        metadata: e.metadata,
        actorName: e.actor_name,
        actorType: e.actor_type,
        at: e.created_at.toISOString(),
      })),
      actions: routeActions(actor, r.status, stops.filter((x) => ['PENDING', 'ON_THE_WAY', 'ARRIVED', 'IN_SERVICE'].includes(x.status)).length),
    };
  });
}

function routeActions(actor: UserActor, status: RouteStatus, openStops: number) {
  const manage = actor.permissions.has('route.manage');
  return {
    edit: manage && status === 'PLANNED',
    cancel: manage && status === 'PLANNED',
    // Encerrar pela equipe: todas as paradas com desfecho (atendida ou problema registrado).
    finish: manage && actor.permissions.has('operation.execute') && status === 'IN_PROGRESS' && openStops === 0,
    reportProblem: manage && actor.permissions.has('incident.report') && status === 'IN_PROGRESS',
  };
}

/** Pedidos prontos, sem rota, agendados para a data — candidatos a parada. */
export async function listPlannableOrders(actor: UserActor, date: string) {
  authorize(actor, 'route.read');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const rows = await tx<{ id: string; number: string; status: string; customer_id: string; customer_name: string | null; order_type: string; address: Record<string, string | null>; latitude: number | null; longitude: number | null; window_start: string | null; window_end: string | null; total_delivery: number; total_collection: number }[]>`
      select o.id, o.number::text as number, o.status, o.customer_id, coalesce(c.trade_name, c.legal_name) as customer_name, o.order_type, o.address,
             o.latitude::float8 as latitude, o.longitude::float8 as longitude,
             to_char(o.window_start, 'HH24:MI') as window_start, to_char(o.window_end, 'HH24:MI') as window_end,
             coalesce((select sum(i.delivery_quantity) from public.order_items i where i.order_id = o.id), 0)::int as total_delivery,
             coalesce((select sum(i.collection_quantity) from public.order_items i where i.order_id = o.id), 0)::int as total_collection
        from public.orders o
        left join public.customers c on c.id = o.customer_id
       where o.organization_id = app.current_org_id() and o.status = any (${[...ROUTABLE_STATUSES]}::text[]) and o.route_id is null
         and o.scheduled_date = ${date}::date
       order by o.window_start nulls last, o.number`;
    // Pedidos da data que ainda não podem entrar (falta confirmar): a tela avisa em vez de sumir com eles.
    const [waiting] = await tx<{ n: number }[]>`
      select count(*)::int as n from public.orders
       where organization_id = app.current_org_id() and status in ('DRAFT', 'NEW', 'RESCHEDULED') and scheduled_date = ${date}::date`;
    const orders = rows.map((o) => ({
      id: o.id,
      number: formatOrderNumber(o.number),
      status: o.status,
      customerId: o.customer_id,
      customerName: o.customer_name,
      type: o.order_type,
      address: o.address,
      latitude: o.latitude,
      longitude: o.longitude,
      windowStart: o.window_start,
      windowEnd: o.window_end,
      totalDelivery: o.total_delivery,
      totalCollection: o.total_collection,
    }));
    return { orders, awaitingConfirmation: waiting?.n ?? 0 };
  });
}

// -----------------------------------------------------------------------------
// Planejamento
// -----------------------------------------------------------------------------

export const createRouteSchema = z.strictObject({
  routeDate: isoDate,
  driverId: z.uuid(),
  vehicleId: z.uuid().nullable().optional(),
  orderIds: z.array(z.uuid()).min(1).max(MAX_STOPS),
  notes: z.string().trim().max(1000).nullable().optional().transform((v) => v || null),
});

async function lockDriver(tx: Tx, driverId: string) {
  const [d] = await tx<{ id: string; status: string; default_vehicle_id: string | null; full_name: string }[]>`
    select id, status, default_vehicle_id, full_name from public.drivers where id = ${driverId} and organization_id = app.current_org_id() for update`;
  if (!d) throw new NotFoundError('Motorista não encontrado.');
  if (d.status !== 'ACTIVE') throw new BusinessRuleError('Motorista não está ativo.');
  return d;
}

async function lockVehicle(tx: Tx, vehicleId: string) {
  const [v] = await tx<{ id: string; status: string; capacity: number }[]>`
    select id, status, capacity from public.vehicles where id = ${vehicleId} and organization_id = app.current_org_id() for share`;
  if (!v) throw new NotFoundError('Veículo não encontrado.');
  if (v.status !== 'ACTIVE') throw new BusinessRuleError('Veículo não está disponível (inativo ou em manutenção).');
  return v;
}

async function deliveryTotal(tx: Tx, orderIds: string[]): Promise<number> {
  if (orderIds.length === 0) return 0;
  const [row] = await tx<{ total: number }[]>`
    select coalesce(sum(delivery_quantity), 0)::int as total from public.order_items where order_id = any (${orderIds}::uuid[])`;
  return row?.total ?? 0;
}

async function routeOrderIds(tx: Tx, routeId: string): Promise<string[]> {
  return (await tx<{ order_id: string }[]>`select order_id from public.route_stops where route_id = ${routeId}`).map((r) => r.order_id);
}

/**
 * Coloca pedidos na rota: trava os pedidos (ordem estável por id, evita
 * deadlock), exige READY + sem rota + mesma data, confere capacidade e aplica
 * READY → ROUTE_ASSIGNED (que garante a reserva) na mesma transação.
 */
async function addOrdersToRoute(tx: Tx, actor: UserActor, route: { id: string; date: string; driverId: string; capacity: number }, orderIds: string[]) {
  const unique = [...new Set(orderIds)].sort();
  if (unique.length !== orderIds.length) throw new ValidationError('Pedido repetido na seleção.');
  const locked = await tx<{ id: string; number: string; status: string; route_id: string | null; scheduled_date: string; customer_id: string; latitude: string | null; longitude: string | null }[]>`
    select id, number::text as number, status, route_id, scheduled_date::text as scheduled_date, customer_id, latitude::text, longitude::text
      from public.orders where id = any (${unique}::uuid[]) and organization_id = app.current_org_id()
     order by id for update`;
  if (locked.length !== unique.length) throw new NotFoundError('Pedido não encontrado.');
  for (const o of locked) {
    const label = formatOrderNumber(o.number);
    if (o.route_id) throw new BusinessRuleError(`O pedido ${label} já está em outra rota.`);
    if (!(ROUTABLE_STATUSES as readonly string[]).includes(o.status)) {
      throw new BusinessRuleError(`O pedido ${label} precisa estar confirmado para entrar na rota (status atual: ${o.status}).`);
    }
    if (o.scheduled_date !== route.date) throw new BusinessRuleError(`O pedido ${label} está agendado para outra data.`);
  }
  const existing = await routeOrderIds(tx, route.id);
  if (existing.length + unique.length > MAX_STOPS) throw new BusinessRuleError(`Uma rota comporta até ${MAX_STOPS} paradas.`);
  assertCapacity(route.capacity, await deliveryTotal(tx, [...existing, ...unique]));

  const [{ max }] = (await tx`select coalesce(max(sequence), 0)::int as max from public.route_stops where route_id = ${route.id}`) as unknown as [{ max: number }];
  let seq = max;
  // Mantém a ordem escolhida pelo usuário (não a ordem de lock).
  const byId = new Map(locked.map((o) => [o.id, o]));
  for (const orderId of orderIds) {
    const o = byId.get(orderId)!;
    for (const step of STEPS_TO_READY[o.status] ?? []) {
      await applyTransition(tx, actor, orderId, { to: step, reason: 'Avançado ao montar a rota', overrideStock: false, windowStart: null, windowEnd: null });
    }
    await applyTransition(tx, actor, orderId, { to: 'ROUTE_ASSIGNED', overrideStock: false, windowStart: null, windowEnd: null });
    await tx`update public.orders set route_id = ${route.id}, driver_id = ${route.driverId} where id = ${orderId}`;
    seq += 1;
    const [stop] = await tx<{ id: string }[]>`
      insert into public.route_stops (organization_id, route_id, order_id, customer_id, sequence, latitude, longitude)
      values (${actor.organizationId}, ${route.id}, ${orderId}, ${o.customer_id}, ${seq}, ${o.latitude}, ${o.longitude})
      returning id`;
    // Evento no nível da rota: parada planejada pode ser removida (a linha do tempo é append-only).
    await insertRouteEvent(tx, actor, { routeId: route.id, type: 'STOP_ADDED', metadata: { order_id: orderId, stop_id: stop!.id, sequence: seq } });
  }
}

/** Ordem manual/otimização deixam de valer quando o conjunto de paradas muda. */
async function resetOrdering(tx: Tx, routeId: string) {
  await tx`update public.routes set ordering = 'MANUAL', distance_meters = null, duration_seconds = null, optimized_at = null where id = ${routeId}`;
}

export async function createRoute(actor: UserActor, input: z.infer<typeof createRouteSchema>, idempotencyKey?: string) {
  authorize(actor, 'route.manage');
  authorize(actor, 'order.update');
  if (input.routeDate < todayInSaoPaulo()) throw new BusinessRuleError('A data da rota não pode ser no passado.');
  const run = async (tx: Tx) => {
    const driver = await lockDriver(tx, input.driverId);
    const vehicleId = input.vehicleId ?? driver.default_vehicle_id;
    if (!vehicleId) throw new ValidationError('Escolha o veículo (o motorista não tem veículo padrão).', [{ path: 'vehicleId', message: 'obrigatório' }]);
    const vehicle = await lockVehicle(tx, vehicleId);
    const [open] = await tx`
      select 1 from public.routes where driver_id = ${driver.id} and route_date = ${input.routeDate} and status in ('PLANNED', 'IN_PROGRESS')`;
    if (open) throw new BusinessRuleError(`${driver.full_name} já tem uma rota aberta nesta data. Adicione os pedidos a ela.`);
    const [route] = await tx<{ id: string }[]>`
      insert into public.routes (organization_id, route_date, driver_id, vehicle_id, notes, created_by)
      values (${actor.organizationId}, ${input.routeDate}, ${driver.id}, ${vehicle.id}, ${input.notes}, ${actor.userId})
      returning id`;
    const id = route!.id;
    await insertRouteEvent(tx, actor, { routeId: id, type: 'ROUTE_CREATED', to: 'PLANNED' });
    await addOrdersToRoute(tx, actor, { id, date: input.routeDate, driverId: driver.id, capacity: vehicle.capacity }, input.orderIds);
    await recordAudit(tx, actor, actor.organizationId, { action: 'route.created', entityType: 'route', entityId: id, after: input });
    await recordOutboxEvent(tx, {
      organizationId: actor.organizationId,
      eventType: 'RoutePlanned',
      aggregateType: 'route',
      aggregateId: id,
      payload: { route_id: id, route_date: input.routeDate, driver_id: driver.id, stops: input.orderIds.length },
      idempotencyKey: `RoutePlanned:${id}`,
    });
    return { id };
  };
  if (idempotencyKey) return (await executeIdempotent(actor, { scope: 'route.create', key: idempotencyKey, request: input }, run)).result;
  return withActorTransaction(toDbContext(actor), run);
}

/** Trava a rota e exige PLANNED (edição só antes de sair). */
async function lockPlanned(tx: Tx, routeId: string): Promise<RouteRow> {
  const r = await findRoute(tx, routeId, true);
  if (!r) throw new NotFoundError('Rota não encontrada.');
  if (r.status !== 'PLANNED') throw new BusinessRuleError('Só é possível alterar rotas planejadas (ainda não iniciadas).');
  return r;
}

export const addStopsSchema = z.strictObject({ orderIds: z.array(z.uuid()).min(1).max(MAX_STOPS) });

export async function addStops(actor: UserActor, routeId: string, orderIds: string[]) {
  authorize(actor, 'route.manage');
  authorize(actor, 'order.update');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const r = await lockPlanned(tx, routeId);
    await addOrdersToRoute(tx, actor, { id: r.id, date: r.route_date, driverId: r.driver_id, capacity: r.vehicle_capacity }, orderIds);
    await resetOrdering(tx, routeId);
    await recordAudit(tx, actor, actor.organizationId, { action: 'route.stops_added', entityType: 'route', entityId: routeId, after: { orderIds } });
    return { added: orderIds.length };
  });
}

async function resequence(tx: Tx, routeId: string) {
  await tx`
    update public.route_stops s set sequence = n.rn
      from (select id, row_number() over (order by sequence) as rn from public.route_stops where route_id = ${routeId}) n
     where s.id = n.id and s.sequence <> n.rn`;
}

/** Tira o pedido da rota: volta a READY com a reserva mantida. */
async function detachOrder(tx: Tx, actor: UserActor, orderId: string) {
  await applyTransition(tx, actor, orderId, { to: 'READY', overrideStock: false, windowStart: null, windowEnd: null });
  await tx`update public.orders set route_id = null, driver_id = null where id = ${orderId}`;
}

export async function removeStop(actor: UserActor, routeId: string, stopId: string) {
  authorize(actor, 'route.manage');
  authorize(actor, 'order.update');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    await lockPlanned(tx, routeId);
    const [stop] = await tx<{ id: string; order_id: string }[]>`select id, order_id from public.route_stops where id = ${stopId} and route_id = ${routeId} for update`;
    if (!stop) throw new NotFoundError('Parada não encontrada.');
    await detachOrder(tx, actor, stop.order_id);
    await insertRouteEvent(tx, actor, { routeId, type: 'STOP_REMOVED', metadata: { order_id: stop.order_id } });
    await tx`delete from public.route_stops where id = ${stopId}`;
    await resequence(tx, routeId);
    await resetOrdering(tx, routeId);
    await recordAudit(tx, actor, actor.organizationId, { action: 'route.stop_removed', entityType: 'route', entityId: routeId, before: { order_id: stop.order_id } });
    return { removed: true };
  });
}

export const reorderSchema = z.strictObject({ stopIds: z.array(z.uuid()).min(1).max(MAX_STOPS) });

async function applyOrder(tx: Tx, routeId: string, stopIds: string[]) {
  // A constraint de sequência é DEFERRABLE: trocas no meio da transação não colidem.
  for (let i = 0; i < stopIds.length; i += 1) {
    await tx`update public.route_stops set sequence = ${i + 1} where id = ${stopIds[i]!} and route_id = ${routeId}`;
  }
}

export async function reorderStops(actor: UserActor, routeId: string, stopIds: string[]) {
  authorize(actor, 'route.manage');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    await lockPlanned(tx, routeId);
    const current = (await tx<{ id: string }[]>`select id from public.route_stops where route_id = ${routeId}`).map((s) => s.id);
    assertPermutation(current, stopIds);
    await applyOrder(tx, routeId, stopIds);
    await resetOrdering(tx, routeId);
    await insertRouteEvent(tx, actor, { routeId, type: 'STOPS_REORDERED', metadata: { method: 'MANUAL' } });
    return { ordering: 'MANUAL' as const };
  });
}

/**
 * Otimiza a ordem pela Google Routes API. A chamada externa acontece FORA da
 * transação; depois a rota é travada de novo e só é alterada se ainda estiver
 * planejada e com as mesmas paradas. Falha externa não muda nada.
 */
export async function optimizeRoute(actor: UserActor, routeId: string) {
  authorize(actor, 'route.manage');
  const provider = getMapsProvider();
  if (!provider) throw new BusinessRuleError('Otimização indisponível: a chave do Google Maps (servidor) não está configurada. Ordene as paradas manualmente.');
  const snapshot = await withActorTransaction(toDbContext(actor), async (tx) => {
    const r = await findRoute(tx, routeId);
    if (!r) throw new NotFoundError('Rota não encontrada.');
    if (r.status !== 'PLANNED') throw new BusinessRuleError('Só é possível otimizar rotas planejadas.');
    const depot = (await readSettings(tx, actor.organizationId)).routes.depot;
    if (!depot) throw new BusinessRuleError('Cadastre a base de saída das rotas para otimizar.');
    const stops = await tx<{ id: string; latitude: number | null; longitude: number | null }[]>`
      select id, latitude::float8 as latitude, longitude::float8 as longitude from public.route_stops where route_id = ${routeId} order by sequence`;
    return { depot, stops };
  });
  const { depot, stops } = snapshot;
  if (stops.length < 2) throw new BusinessRuleError('A rota precisa de ao menos duas paradas para otimizar.');
  if (stops.length > MAX_OPTIMIZED_STOPS) throw new BusinessRuleError(`A otimização automática aceita até ${MAX_OPTIMIZED_STOPS} paradas. Divida a rota ou ordene manualmente.`);
  const missing = stops.filter((s) => s.latitude === null || s.longitude === null).length;
  if (missing) throw new BusinessRuleError(`${missing} parada(s) sem localização. Corrija o endereço do cliente no mapa antes de otimizar.`);

  let result;
  try {
    const origin = { id: 'depot', lat: depot.latitude, lng: depot.longitude };
    result = await provider.optimizeRoute(origin, stops.map((s) => ({ id: s.id, lat: s.latitude!, lng: s.longitude! })), origin);
  } catch (err) {
    if (err instanceof ProviderError) {
      logger.warn('route.optimize_failed', { route_id: routeId, error: err });
      throw new BusinessRuleError('Não foi possível otimizar agora (serviço de mapas indisponível). Tente de novo ou ordene manualmente.');
    }
    throw err;
  }

  return withActorTransaction(toDbContext(actor), async (tx) => {
    await lockPlanned(tx, routeId);
    const current = (await tx<{ id: string }[]>`select id from public.route_stops where route_id = ${routeId}`).map((s) => s.id);
    try {
      assertPermutation(current, result.orderedStopIds);
    } catch {
      throw new BusinessRuleError('As paradas mudaram durante a otimização. Tente de novo.');
    }
    await applyOrder(tx, routeId, result.orderedStopIds);
    await tx`
      update public.routes set ordering = 'OPTIMIZED', distance_meters = ${result.distanceMeters}, duration_seconds = ${result.durationSeconds},
             optimized_at = now()
       where id = ${routeId}`;
    await insertRouteEvent(tx, actor, {
      routeId,
      type: 'STOPS_REORDERED',
      metadata: { method: 'OPTIMIZED', provider: provider.name, distance_meters: result.distanceMeters, duration_seconds: result.durationSeconds },
    });
    return { ordering: 'OPTIMIZED' as const, distanceMeters: result.distanceMeters, durationSeconds: result.durationSeconds };
  });
}

export const updateRouteSchema = z.strictObject({
  driverId: z.uuid().optional(),
  vehicleId: z.uuid().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export async function updateRoute(actor: UserActor, routeId: string, patch: z.infer<typeof updateRouteSchema>) {
  authorize(actor, 'route.manage');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const r = await lockPlanned(tx, routeId);
    const driverId = patch.driverId ?? r.driver_id;
    const vehicleId = patch.vehicleId ?? r.vehicle_id;
    if (patch.driverId && patch.driverId !== r.driver_id) {
      await lockDriver(tx, patch.driverId);
      const [open] = await tx`
        select 1 from public.routes where driver_id = ${patch.driverId} and route_date = ${r.route_date} and status in ('PLANNED', 'IN_PROGRESS') and id <> ${routeId}`;
      if (open) throw new BusinessRuleError('Este motorista já tem uma rota aberta nesta data.');
    }
    if (patch.vehicleId && patch.vehicleId !== r.vehicle_id) {
      const v = await lockVehicle(tx, patch.vehicleId);
      assertCapacity(v.capacity, await deliveryTotal(tx, await routeOrderIds(tx, routeId)));
    }
    await tx`
      update public.routes set driver_id = ${driverId}, vehicle_id = ${vehicleId},
             notes = case when ${patch.notes !== undefined} then ${patch.notes ?? null} else notes end
       where id = ${routeId}`;
    if (driverId !== r.driver_id) await tx`update public.orders set driver_id = ${driverId} where route_id = ${routeId}`;
    await insertRouteEvent(tx, actor, { routeId, type: 'ROUTE_UPDATED', metadata: { driver_id: driverId, vehicle_id: vehicleId } });
    await recordAudit(tx, actor, actor.organizationId, {
      action: 'route.updated',
      entityType: 'route',
      entityId: routeId,
      before: { driver_id: r.driver_id, vehicle_id: r.vehicle_id, notes: r.notes },
      after: patch,
    });
    return { id: routeId };
  });
}

export const cancelRouteSchema = z.strictObject({ reason: z.string().trim().min(3).max(500) });

/**
 * Cancela rota planejada: os pedidos voltam a READY (reserva mantida) e as
 * paradas ficam registradas como SKIPPED. Rota em andamento não é cancelada
 * por aqui: as toalhas já saíram e cada parada precisa de desfecho (Fase 6).
 */
export async function cancelRoute(actor: UserActor, routeId: string, reason: string) {
  authorize(actor, 'route.manage');
  authorize(actor, 'order.update');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const r = await findRoute(tx, routeId, true);
    if (!r) throw new NotFoundError('Rota não encontrada.');
    if (r.status === 'IN_PROGRESS') {
      throw new BusinessRuleError('Rota em andamento não pode ser cancelada: as toalhas já saíram. Registre o desfecho de cada parada.');
    }
    routeStateMachine.assertTransition(r.status, 'CANCELLED');
    const stops = await tx<{ id: string; order_id: string }[]>`select id, order_id from public.route_stops where route_id = ${routeId} order by order_id for update`;
    for (const s of stops) {
      await detachOrder(tx, actor, s.order_id);
      await tx`update public.route_stops set status = 'SKIPPED', status_reason = ${`Rota cancelada: ${reason}`} where id = ${s.id}`;
    }
    await tx`update public.routes set status = 'CANCELLED', status_reason = ${reason}, cancelled_at = now() where id = ${routeId}`;
    await insertRouteEvent(tx, actor, { routeId, type: 'ROUTE_CANCELLED', from: r.status, to: 'CANCELLED', reason, metadata: { released_orders: stops.length } });
    await recordAudit(tx, actor, actor.organizationId, { action: 'route.cancelled', entityType: 'route', entityId: routeId, before: { status: r.status }, after: { status: 'CANCELLED' }, metadata: { reason } });
    await recordOutboxEvent(tx, {
      organizationId: actor.organizationId,
      eventType: 'RouteCancelled',
      aggregateType: 'route',
      aggregateId: routeId,
      payload: { route_id: routeId, route_date: r.route_date, reason },
      idempotencyKey: `RouteCancelled:${routeId}`,
    });
    return { status: 'CANCELLED' as const };
  });
}

// -----------------------------------------------------------------------------
// Base de saída (origem/destino da otimização)
// -----------------------------------------------------------------------------

export const depotSchema = z.strictObject({
  name: z.string().trim().min(2).max(100),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export async function getDepot(actor: UserActor) {
  authorize(actor, 'route.read');
  return withActorTransaction(toDbContext(actor), async (tx) => (await readSettings(tx, actor.organizationId)).routes.depot);
}

export async function updateDepot(actor: UserActor, depot: z.infer<typeof depotSchema>) {
  authorize(actor, 'route.manage');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const before = (await readSettings(tx, actor.organizationId)).routes.depot;
    // organizations_update_settings exige organization.manage; a base de saída é operacional (route.manage),
    // então a escrita passa por função restrita ao campo routes.depot.
    await tx`select app.set_route_depot(${tx.json(depot)})`;
    await recordAudit(tx, actor, actor.organizationId, { action: 'route.depot_updated', entityType: 'organization', entityId: actor.organizationId, before, after: depot });
    return depot;
  });
}
