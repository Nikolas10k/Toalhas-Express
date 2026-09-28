import 'server-only';
import { z } from 'zod';
import { formatAddress } from '@/lib/br/address';
import { toDbContext, type UserActor } from '@/server/auth/actor';
import { authorize, hasPermission } from '@/server/authz/authorize';
import { AuthorizationError, BusinessRuleError, NotFoundError } from '@/server/core/errors';
import type { Tx } from '@/server/db/client';
import { withActorTransaction } from '@/server/db/transaction';
import { recordAudit } from '@/server/modules/audit/audit.service';
import { recordMovements } from '@/server/modules/inventory/inventory.service';
import { addDays, formatOrderNumber, todayInSaoPaulo } from '@/server/modules/orders/orders.domain';
import { reservedByOrder } from '@/server/modules/orders/orders.repository';
import { applyTransition } from '@/server/modules/orders/orders.service';
import { recordOutboxEvent } from '@/server/modules/outbox/outbox.service';
import { assertCanFinish, navigationUrl, routeStateMachine, stopStateMachine, type StopStatus } from './routes.domain';
import { geoSchema } from './geo.schema';
import { findRoute, insertRouteEvent, routeStops, stopItems, type GeoPoint, type RouteRow } from './routes.repository';

/**
 * App do motorista. Tudo passa pelo RLS (rotas do próprio motorista) e por
 * conferência explícita de dono. O motorista nunca vê valores, contratos,
 * dívidas nem notas internas.
 */

export { geoSchema } from './geo.schema';

async function currentDriverId(tx: Tx): Promise<string> {
  const [row] = await tx<{ id: string | null }[]>`select app.current_driver_id() as id`;
  if (!row?.id) throw new AuthorizationError('Seu usuário não está cadastrado como motorista ativo. Fale com a operação.');
  return row.id;
}

async function ownRoute(tx: Tx, routeId: string, forUpdate = false): Promise<RouteRow> {
  const driverId = await currentDriverId(tx);
  const r = await findRoute(tx, routeId, forUpdate);
  // Rota de outro motorista responde como inexistente (sem vazar que existe).
  if (!r || r.driver_id !== driverId) throw new NotFoundError('Rota não encontrada.');
  return r;
}

function driverRouteSummary(r: { id: string; route_date: string; status: string; vehicle_plate: string; stops: number; open_stops: number }) {
  return { id: r.id, date: r.route_date, status: r.status, vehiclePlate: r.vehicle_plate, stops: r.stops, openStops: r.open_stops };
}

/** Rotas de hoje, em andamento (inclusive de dias anteriores) e as próximas 7 dias. */
export async function getDriverHome(actor: UserActor) {
  authorize(actor, 'driver_app.access');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const driverId = await currentDriverId(tx);
    const today = todayInSaoPaulo();
    const rows = await tx<{ id: string; route_date: string; status: string; vehicle_plate: string; stops: number; open_stops: number }[]>`
      select r.id, r.route_date::text as route_date, r.status, v.plate as vehicle_plate,
             (select count(*) from public.route_stops s where s.route_id = r.id)::int as stops,
             (select count(*) from public.route_stops s where s.route_id = r.id and s.status in ('PENDING', 'ON_THE_WAY', 'ARRIVED', 'IN_SERVICE'))::int as open_stops
        from public.routes r join public.vehicles v on v.id = r.vehicle_id
       where r.driver_id = ${driverId}
         and (r.status = 'IN_PROGRESS' or (r.status = 'PLANNED' and r.route_date between ${today}::date and ${addDays(today, 7)}::date)
              or (r.status = 'COMPLETED' and r.route_date = ${today}::date))
       order by r.status = 'IN_PROGRESS' desc, r.route_date`;
    return { today, routes: rows.map(driverRouteSummary) };
  });
}

export async function getDriverRoute(actor: UserActor, routeId: string) {
  authorize(actor, 'driver_app.access');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const r = await ownRoute(tx, routeId);
    const stops = await routeStops(tx, routeId);
    const items = await stopItems(tx, routeId);
    const open = r.status === 'PLANNED' || r.status === 'IN_PROGRESS';
    const current = stops.find((s) => s.status === 'ON_THE_WAY' || s.status === 'ARRIVED' || s.status === 'IN_SERVICE') ?? null;
    return {
      route: { id: r.id, date: r.route_date, status: r.status, vehiclePlate: r.vehicle_plate, vehicleModel: r.vehicle_model, notes: r.notes },
      canStart: r.status === 'PLANNED' && r.route_date <= todayInSaoPaulo() && stops.length > 0,
      canFinish: r.status === 'IN_PROGRESS' && stops.every((s) => !['PENDING', 'ON_THE_WAY', 'ARRIVED', 'IN_SERVICE'].includes(s.status)),
      currentStopId: current?.id ?? null,
      stops: stops.map((s) => {
        const address = formatAddress({
          street: s.address.street ?? null,
          number: s.address.number ?? null,
          complement: s.address.complement ?? null,
          district: s.address.district ?? null,
          city: s.address.city ?? null,
          state: s.address.state ?? null,
          postalCode: s.address.postalCode ?? null,
        });
        const point = s.latitude !== null && s.longitude !== null ? { lat: s.latitude, lng: s.longitude } : null;
        return {
          id: s.id,
          sequence: s.sequence,
          status: s.status,
          orderNumber: formatOrderNumber(s.order_number),
          type: s.order_type,
          // Dados pessoais só enquanto a rota está aberta (RLS também restringe).
          customerName: open ? s.customer_name : null,
          phone: open ? s.customer_whatsapp ?? s.customer_phone : null,
          address,
          navigationUrl: open ? navigationUrl(point, address) : null,
          windowStart: s.window_start,
          windowEnd: s.window_end,
          notes: s.notes,
          items: items
            .filter((i) => i.order_id === s.order_id)
            .map((i) => ({ name: i.name, deliveryQuantity: i.delivery_quantity, collectionQuantity: i.collection_quantity })),
          arrivedAt: s.arrived_at?.toISOString() ?? null,
        };
      }),
    };
  });
}

/**
 * Iniciar rota: numa transação, carrega o veículo (RESERVED → IN_ROUTE, ou
 * AVAILABLE → IN_ROUTE para o que faltar reservar), pedidos vão para
 * IN_TRANSIT e a primeira parada fica "a caminho". Repetir não duplica nada.
 */
export async function startRoute(actor: UserActor, routeId: string, geo: GeoPoint | null) {
  authorize(actor, 'driver_app.access');
  authorize(actor, 'operation.execute');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const r = await ownRoute(tx, routeId, true);
    if (r.status === 'IN_PROGRESS') return { status: r.status, replayed: true };
    routeStateMachine.assertTransition(r.status, 'IN_PROGRESS');
    if (r.route_date > todayInSaoPaulo()) throw new BusinessRuleError('Esta rota é de outro dia e ainda não pode ser iniciada.');
    if (r.driver_status !== 'ACTIVE') throw new BusinessRuleError('Seu cadastro de motorista não está ativo.');
    const stops = await tx<{ id: string; order_id: string; customer_id: string; sequence: number }[]>`
      select id, order_id, customer_id, sequence from public.route_stops where route_id = ${routeId} and status = 'PENDING' order by sequence for update`;
    if (stops.length === 0) throw new BusinessRuleError('A rota não tem paradas.');

    let loaded = 0;
    for (const s of stops) {
      const items = await tx<{ product_id: string; delivery_quantity: number }[]>`
        select product_id, delivery_quantity from public.order_items where order_id = ${s.order_id} and delivery_quantity > 0`;
      const reserved = await reservedByOrder(tx, s.order_id);
      const movements = items.flatMap((i) => {
        const fromReserved = Math.min(i.delivery_quantity, reserved.get(i.product_id) ?? 0);
        const fromAvailable = i.delivery_quantity - fromReserved;
        const base = { productId: i.product_id, type: 'DELIVERY_DISPATCH' as const, to: 'IN_ROUTE' as const, customerId: s.customer_id, orderId: s.order_id, routeId, routeStopId: s.id, driverId: r.driver_id };
        return [
          ...(fromReserved > 0 ? [{ ...base, quantity: fromReserved, from: 'RESERVED' as const, idempotencyKey: `route:${routeId}:dispatch:${s.order_id}:${i.product_id}:reserved` }] : []),
          ...(fromAvailable > 0 ? [{ ...base, quantity: fromAvailable, from: 'AVAILABLE' as const, idempotencyKey: `route:${routeId}:dispatch:${s.order_id}:${i.product_id}:available` }] : []),
        ];
      });
      if (movements.length) await recordMovements(tx, actor, movements);
      loaded += movements.reduce((a, m) => a + m.quantity, 0);
      await applyTransition(tx, actor, s.order_id, { to: 'IN_TRANSIT', overrideStock: false, windowStart: null, windowEnd: null });
    }
    const first = stops[0]!;
    await tx`update public.route_stops set status = 'ON_THE_WAY', on_the_way_at = now() where id = ${first.id}`;
    await tx`update public.routes set status = 'IN_PROGRESS', started_at = now() where id = ${routeId}`;
    await insertRouteEvent(tx, actor, { routeId, type: 'ROUTE_STARTED', from: 'PLANNED', to: 'IN_PROGRESS', metadata: { loaded }, geo });
    await insertRouteEvent(tx, actor, { routeId, stopId: first.id, type: 'STOP_STATUS', from: 'PENDING', to: 'ON_THE_WAY', geo });
    await recordAudit(tx, actor, actor.organizationId, { action: 'route.started', entityType: 'route', entityId: routeId, after: { status: 'IN_PROGRESS', loaded } });
    await recordOutboxEvent(tx, {
      organizationId: actor.organizationId,
      eventType: 'RouteStarted',
      aggregateType: 'route',
      aggregateId: routeId,
      payload: { route_id: routeId, route_date: r.route_date, driver_id: r.driver_id, stops: stops.length, loaded },
      idempotencyKey: `RouteStarted:${routeId}`,
    });
    return { status: 'IN_PROGRESS' as const, replayed: false, loaded };
  });
}

export const stopActionSchema = z.strictObject({
  action: z.enum(['ON_THE_WAY', 'ARRIVED']),
  geo: geoSchema,
});

/**
 * "Ir para esta parada" (ON_THE_WAY) e "Cheguei" (ARRIVED). Só uma parada a
 * caminho por vez: escolher outra devolve a anterior para PENDING. Parada em
 * atendimento precisa ser concluída antes (Fase 6).
 */
export async function driverStopAction(actor: UserActor, stopId: string, input: z.infer<typeof stopActionSchema>) {
  authorize(actor, 'driver_app.access');
  authorize(actor, 'operation.execute');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const [stop] = await tx<{ id: string; route_id: string; status: StopStatus }[]>`
      select id, route_id, status from public.route_stops where id = ${stopId}`;
    if (!stop) throw new NotFoundError('Parada não encontrada.');
    const r = await ownRoute(tx, stop.route_id, true);
    if (r.status !== 'IN_PROGRESS') throw new BusinessRuleError('Inicie a rota antes de operar as paradas.');
    const [locked] = await tx<{ status: StopStatus }[]>`select status from public.route_stops where id = ${stopId} for update`;
    const from = locked!.status;
    const to = input.action;
    if (from === to) return { status: to, replayed: true };

    if (to === 'ON_THE_WAY') {
      const busy = await tx<{ id: string; status: StopStatus }[]>`
        select id, status from public.route_stops
         where route_id = ${r.id} and id <> ${stopId} and status in ('ON_THE_WAY', 'ARRIVED', 'IN_SERVICE') for update`;
      if (busy.some((b) => b.status !== 'ON_THE_WAY')) {
        throw new BusinessRuleError('Conclua a parada em que você está antes de seguir para outra.');
      }
      for (const b of busy) {
        stopStateMachine.assertTransition(b.status, 'PENDING');
        await tx`update public.route_stops set status = 'PENDING' where id = ${b.id}`;
        await insertRouteEvent(tx, actor, { routeId: r.id, stopId: b.id, type: 'STOP_STATUS', from: b.status, to: 'PENDING', geo: input.geo });
      }
    }
    stopStateMachine.assertTransition(from, to);
    await tx`
      update public.route_stops
         set status = ${to},
             on_the_way_at = case when ${to} = 'ON_THE_WAY' then now() else on_the_way_at end,
             arrived_at = case when ${to} = 'ARRIVED' then now() else arrived_at end
       where id = ${stopId}`;
    await insertRouteEvent(tx, actor, { routeId: r.id, stopId, type: 'STOP_STATUS', from, to, geo: input.geo });
    if (to === 'ARRIVED') {
      const [o] = await tx<{ order_id: string }[]>`select order_id from public.route_stops where id = ${stopId}`;
      await recordOutboxEvent(tx, {
        organizationId: actor.organizationId,
        eventType: 'StopArrived',
        aggregateType: 'route_stop',
        aggregateId: stopId,
        payload: { route_id: r.id, stop_id: stopId, order_id: o!.order_id, geolocation: input.geo ? 'captured' : 'unavailable' },
        idempotencyKey: `StopArrived:${stopId}`,
      });
    }
    return { status: to, replayed: false };
  });
}

/**
 * Finaliza a rota quando nenhuma parada ficou aberta: as toalhas que não
 * foram entregues voltam ao estoque (IN_ROUTE → AVAILABLE), pedidos entregues
 * são concluídos e pedidos com problema saem da rota para serem replanejados.
 * O motorista finaliza a própria rota; a equipe (route.manage) pode encerrar.
 */
export async function finishRoute(actor: UserActor, routeId: string, geo: GeoPoint | null) {
  const staff = hasPermission(actor, 'route.manage');
  if (!staff) authorize(actor, 'driver_app.access');
  authorize(actor, 'operation.execute');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    let r: RouteRow;
    if (staff) {
      const found = await findRoute(tx, routeId, true);
      if (!found) throw new NotFoundError('Rota não encontrada.');
      r = found;
    } else {
      r = await ownRoute(tx, routeId, true);
    }
    if (r.status === 'COMPLETED') return { status: r.status, replayed: true, returned: 0 };
    routeStateMachine.assertTransition(r.status, 'COMPLETED');
    const stops = await tx<{ status: StopStatus }[]>`select status from public.route_stops where route_id = ${routeId} for update`;
    assertCanFinish(stops);

    // Saldo "em rota" desta rota por produto: saiu − entregue − já devolvido.
    const leftovers = await tx<{ product_id: string; q: number }[]>`
      select product_id,
             (coalesce(sum(quantity) filter (where to_state = 'IN_ROUTE'), 0) - coalesce(sum(quantity) filter (where from_state = 'IN_ROUTE'), 0))::int as q
        from public.towel_movements
       where route_id = ${routeId} and ('IN_ROUTE' in (from_state, to_state))
       group by product_id`;
    const returns = leftovers
      .filter((l) => l.q > 0)
      .map((l) => ({
        productId: l.product_id,
        type: 'TRANSFER' as const,
        quantity: l.q,
        from: 'IN_ROUTE' as const,
        to: 'AVAILABLE' as const,
        routeId,
        driverId: r.driver_id,
        reason: 'Retorno ao fim da rota (não entregues)',
        idempotencyKey: `route:${routeId}:return:${l.product_id}`,
        authorizedBy: 'operation.execute' as const,
      }));
    if (returns.length) await recordMovements(tx, actor, returns);
    const returned = returns.reduce((a, m) => a + m.quantity, 0);

    const orders = await tx<{ id: string; status: string }[]>`
      select id, status from public.orders where route_id = ${routeId} and status in ('DELIVERED', 'DELIVERY_PROBLEM') order by id for update`;
    for (const o of orders) {
      if (o.status === 'DELIVERED') {
        await applyTransition(tx, actor, o.id, { to: 'COMPLETED', overrideStock: false, windowStart: null, windowEnd: null });
      } else {
        // Continua em DELIVERY_PROBLEM para a equipe reagendar ou cancelar, mas livre para outra rota.
        await tx`update public.orders set route_id = null, driver_id = null where id = ${o.id}`;
      }
    }

    await tx`update public.routes set status = 'COMPLETED', completed_at = now() where id = ${routeId}`;
    await insertRouteEvent(tx, actor, { routeId, type: 'ROUTE_COMPLETED', from: r.status, to: 'COMPLETED', geo: staff ? undefined : geo, metadata: { returned, closed_by: staff ? 'STAFF' : 'DRIVER' } });
    await recordAudit(tx, actor, actor.organizationId, { action: 'route.completed', entityType: 'route', entityId: routeId, after: { status: 'COMPLETED', returned } });
    await recordOutboxEvent(tx, {
      organizationId: actor.organizationId,
      eventType: 'RouteCompleted',
      aggregateType: 'route',
      aggregateId: routeId,
      payload: { route_id: routeId, route_date: r.route_date, driver_id: r.driver_id, returned },
      idempotencyKey: `RouteCompleted:${routeId}`,
    });
    return { status: 'COMPLETED' as const, replayed: false, returned };
  });
}
