import 'server-only';
import type { Tx } from '@/server/db/client';
import type { OrderStatus, OrderType } from './orders.domain';

export interface OrderRow {
  id: string;
  number: string;
  customer_id: string;
  customer_name: string | null;
  customer_status: string | null;
  order_type: OrderType;
  status: OrderStatus;
  scheduled_date: string;
  window_start: string | null;
  window_end: string | null;
  address: Record<string, unknown>;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  internal_notes: string | null;
  assigned_to: string | null;
  assigned_name: string | null;
  route_id: string | null;
  source: string;
  recurring_rule_id: string | null;
  stock_override: boolean;
  status_reason: string | null;
  status_changed_at: Date;
  created_at: Date;
}

const ORDER_SELECT = `
  o.id, o.number::text as number, o.customer_id, coalesce(c.trade_name, c.legal_name) as customer_name, c.status as customer_status,
  o.order_type, o.status, o.scheduled_date::text as scheduled_date,
  to_char(o.window_start, 'HH24:MI') as window_start, to_char(o.window_end, 'HH24:MI') as window_end,
  o.address, o.latitude::float8 as latitude, o.longitude::float8 as longitude, o.notes, o.internal_notes,
  o.assigned_to, p.full_name as assigned_name, o.route_id, o.source, o.recurring_rule_id, o.stock_override,
  o.status_reason, o.status_changed_at, o.created_at
`;

export async function findOrder(tx: Tx, id: string, forUpdate = false): Promise<OrderRow | null> {
  const rows = await tx.unsafe<OrderRow[]>(
    `select ${ORDER_SELECT}
       from public.orders o
       left join public.customers c on c.id = o.customer_id
       left join public.profiles p on p.id = o.assigned_to
      where o.id = $1 and o.organization_id = app.current_org_id()
      ${forUpdate ? 'for update of o' : ''}`,
    [id],
  );
  return rows[0] ?? null;
}

export interface ItemRow {
  product_id: string;
  sku: string;
  name: string;
  delivery_quantity: number;
  collection_quantity: number;
}

export async function orderItems(tx: Tx, orderId: string): Promise<ItemRow[]> {
  return tx<ItemRow[]>`
    select i.product_id, p.sku, p.name, i.delivery_quantity, i.collection_quantity
      from public.order_items i join public.products p on p.id = i.product_id
     where i.order_id = ${orderId} order by p.name
  `;
}

/** Reserva atual por produto, derivada do ledger (entradas em RESERVED − saídas de RESERVED). */
export async function reservedByOrder(tx: Tx, orderId: string): Promise<Map<string, number>> {
  const rows = await tx<{ product_id: string; reserved: number }[]>`
    select product_id,
           (coalesce(sum(quantity) filter (where to_state = 'RESERVED'), 0)
            - coalesce(sum(quantity) filter (where from_state = 'RESERVED'), 0))::int as reserved
      from public.towel_movements
     where order_id = ${orderId} and organization_id = app.current_org_id()
     group by product_id
  `;
  return new Map(rows.map((r) => [r.product_id, r.reserved]));
}

export async function orderHistory(tx: Tx, orderId: string) {
  return tx<{ id: string; from_status: string | null; to_status: string; reason: string | null; metadata: Record<string, unknown>; actor_type: string; actor_name: string | null; created_at: Date }[]>`
    select h.id, h.from_status, h.to_status, h.reason, h.metadata, h.actor_type, p.full_name as actor_name, h.created_at
      from public.order_status_history h
      left join public.profiles p on p.id = h.actor_id and h.actor_type = 'USER'
     where h.order_id = ${orderId} order by h.created_at, h.id
  `;
}

export interface OrderListFilters {
  status?: OrderStatus;
  customerId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  offset: number;
  limit: number;
}

export async function listOrders(tx: Tx, f: OrderListFilters) {
  const like = f.search ? `%${f.search.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const num = f.search && /^\D*\d+$/.test(f.search.trim()) ? f.search.replace(/\D/g, '') : null;
  return tx.unsafe<(OrderRow & { total_delivery: number; total_collection: number })[]>(
    `select ${ORDER_SELECT},
            coalesce((select sum(i.delivery_quantity) from public.order_items i where i.order_id = o.id), 0)::int as total_delivery,
            coalesce((select sum(i.collection_quantity) from public.order_items i where i.order_id = o.id), 0)::int as total_collection
       from public.orders o
       left join public.customers c on c.id = o.customer_id
       left join public.profiles p on p.id = o.assigned_to
      where o.organization_id = app.current_org_id()
        and ($1::text is null or o.status = $1)
        and ($2::uuid is null or o.customer_id = $2)
        and ($3::date is null or o.scheduled_date >= $3)
        and ($4::date is null or o.scheduled_date <= $4)
        and ($5::text is null or lower(coalesce(c.trade_name, '')) like $5 or lower(c.legal_name) like $5 or ($6::bigint is not null and o.number = $6))
      order by o.scheduled_date desc, o.number desc
      limit $7 offset $8`,
    [f.status ?? null, f.customerId ?? null, f.dateFrom ?? null, f.dateTo ?? null, like, num, f.limit, f.offset],
  );
}

export async function countOrdersByStatus(tx: Tx, f: { dateFrom?: string; dateTo?: string }) {
  const rows = await tx<{ status: string; total: number }[]>`
    select status, count(*)::int as total from public.orders
     where organization_id = app.current_org_id()
       and (${f.dateFrom ?? null}::date is null or scheduled_date >= ${f.dateFrom ?? null}::date)
       and (${f.dateTo ?? null}::date is null or scheduled_date <= ${f.dateTo ?? null}::date)
     group by status
  `;
  return Object.fromEntries(rows.map((r) => [r.status, r.total]));
}
