import 'server-only';
import type { Tx } from '@/server/db/client';
import type { RouteStatus, StopStatus } from './routes.domain';

export interface RouteRow {
  id: string;
  route_date: string;
  driver_id: string;
  driver_name: string;
  driver_status: string;
  driver_user_id: string | null;
  vehicle_id: string;
  vehicle_plate: string;
  vehicle_model: string;
  vehicle_capacity: number;
  status: RouteStatus;
  distance_meters: number | null;
  duration_seconds: number | null;
  ordering: 'MANUAL' | 'OPTIMIZED';
  optimized_at: Date | null;
  notes: string | null;
  status_reason: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
}

const ROUTE_SELECT = `
  r.id, r.route_date::text as route_date, r.driver_id, d.full_name as driver_name, d.status as driver_status, d.user_id as driver_user_id,
  r.vehicle_id, v.plate as vehicle_plate, v.model as vehicle_model, v.capacity as vehicle_capacity,
  r.status, r.distance_meters, r.duration_seconds, r.ordering, r.optimized_at, r.notes, r.status_reason,
  r.started_at, r.completed_at, r.created_at
`;

export async function findRoute(tx: Tx, id: string, forUpdate = false): Promise<RouteRow | null> {
  if (forUpdate) await tx`select 1 from public.routes where id = ${id} for update`;
  const [row] = await tx.unsafe<RouteRow[]>(
    `select ${ROUTE_SELECT}
       from public.routes r
       join public.drivers d on d.id = r.driver_id
       join public.vehicles v on v.id = r.vehicle_id
      where r.id = $1 and r.organization_id = app.current_org_id()`,
    [id],
  );
  return row ?? null;
}

export interface StopRow {
  id: string;
  sequence: number;
  status: StopStatus;
  order_id: string;
  order_number: string;
  order_status: string;
  order_type: string;
  customer_id: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_whatsapp: string | null;
  address: Record<string, string | null>;
  latitude: number | null;
  longitude: number | null;
  window_start: string | null;
  window_end: string | null;
  notes: string | null;
  total_delivery: number;
  total_collection: number;
  status_reason: string | null;
  on_the_way_at: Date | null;
  arrived_at: Date | null;
  completed_at: Date | null;
}

export async function routeStops(tx: Tx, routeId: string): Promise<StopRow[]> {
  return tx<StopRow[]>`
    select s.id, s.sequence, s.status, s.order_id, o.number::text as order_number, o.status as order_status, o.order_type,
           s.customer_id, coalesce(c.trade_name, c.legal_name) as customer_name, c.phone as customer_phone, c.whatsapp as customer_whatsapp,
           o.address, s.latitude::float8 as latitude, s.longitude::float8 as longitude,
           to_char(o.window_start, 'HH24:MI') as window_start, to_char(o.window_end, 'HH24:MI') as window_end, o.notes,
           coalesce((select sum(i.delivery_quantity) from public.order_items i where i.order_id = o.id), 0)::int as total_delivery,
           coalesce((select sum(i.collection_quantity) from public.order_items i where i.order_id = o.id), 0)::int as total_collection,
           s.status_reason, s.on_the_way_at, s.arrived_at, s.completed_at
      from public.route_stops s
      join public.orders o on o.id = s.order_id
      left join public.customers c on c.id = s.customer_id
     where s.route_id = ${routeId}
     order by s.sequence`;
}

export async function stopItems(tx: Tx, routeId: string) {
  return tx<{ order_id: string; product_id: string; name: string; sku: string; delivery_quantity: number; collection_quantity: number }[]>`
    select i.order_id, i.product_id, p.name, p.sku, i.delivery_quantity, i.collection_quantity
      from public.route_stops s
      join public.order_items i on i.order_id = s.order_id
      join public.products p on p.id = i.product_id
     where s.route_id = ${routeId}
     order by p.name`;
}

export async function routeEvents(tx: Tx, routeId: string) {
  return tx<{ id: string; route_stop_id: string | null; event_type: string; from_status: string | null; to_status: string | null; reason: string | null; metadata: Record<string, unknown>; actor_type: string; actor_name: string | null; created_at: Date }[]>`
    select e.id, e.route_stop_id, e.event_type, e.from_status, e.to_status, e.reason, e.metadata, e.actor_type,
           p.full_name as actor_name, e.created_at
      from public.route_events e
      left join public.profiles p on p.id = e.actor_id and e.actor_type = 'USER'
     where e.route_id = ${routeId}
     order by e.created_at, e.id`;
}

export interface GeoPoint {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
}

export async function insertRouteEvent(
  tx: Tx,
  actor: { type: 'USER'; userId: string; organizationId: string } | { type: 'INTEGRATION'; tokenId: string; organizationId: string },
  // geo: undefined = evento administrativo; null = motorista sem geolocalização (registrado, não bloqueia).
  e: { routeId: string; stopId?: string | null; type: string; from?: string | null; to?: string | null; reason?: string | null; metadata?: Record<string, unknown>; geo?: GeoPoint | null },
) {
  await tx`
    insert into public.route_events (organization_id, route_id, route_stop_id, event_type, from_status, to_status, reason, metadata,
                                     latitude, longitude, actor_type, actor_id, created_at)
    values (${actor.organizationId}, ${e.routeId}, ${e.stopId ?? null}, ${e.type}, ${e.from ?? null}, ${e.to ?? null}, ${e.reason ?? null},
            ${tx.json({ ...(e.metadata ?? {}), ...(e.geo === undefined ? {} : e.geo ? { accuracy: e.geo.accuracy ?? null } : { geolocation: 'unavailable' }) } as never)},
            ${e.geo?.latitude ?? null}, ${e.geo?.longitude ?? null}, ${actor.type}, ${actor.type === 'USER' ? actor.userId : actor.tokenId},
            clock_timestamp())`;
}
