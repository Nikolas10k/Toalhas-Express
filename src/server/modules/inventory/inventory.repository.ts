import 'server-only';
import { cents, type Cents } from '@/server/core/money';
import type { Tx } from '@/server/db/client';
import type { InventoryState, LedgerState, MovementType } from './inventory.domain';

export interface Product {
  id: string;
  sku: string;
  name: string;
  size: string | null;
  category: string | null;
  costCents: Cents;
  replacementPriceCents: Cents;
  minStock: number;
  active: boolean;
  kind: ProductKind;
  createdAt: Date;
}

/** RENTAL = toalha da empresa (estoque/ledger); LINEN = enxoval do cliente (só ordem de serviço). */
export type ProductKind = 'RENTAL' | 'LINEN';

interface ProductRow {
  id: string;
  sku: string;
  name: string;
  size: string | null;
  category: string | null;
  cost_cents: string;
  replacement_price_cents: string;
  min_stock: number;
  active: boolean;
  kind: ProductKind;
  created_at: Date;
}

const mapProduct = (r: ProductRow): Product => ({
  id: r.id,
  sku: r.sku,
  name: r.name,
  size: r.size,
  category: r.category,
  // BIGINT chega como string: conversão validada para centavos.
  costCents: cents(r.cost_cents),
  replacementPriceCents: cents(r.replacement_price_cents),
  minStock: r.min_stock,
  active: r.active,
  kind: r.kind,
  createdAt: r.created_at,
});

export async function listProducts(tx: Tx, opts: { includeInactive?: boolean; kind?: ProductKind } = {}): Promise<Product[]> {
  const rows = await tx<ProductRow[]>`
    select id, sku, name, size, category, cost_cents, replacement_price_cents, min_stock, active, kind, created_at
      from public.products
     where organization_id = app.current_org_id() and deleted_at is null
       ${opts.includeInactive ? tx`` : tx`and active`}
       ${opts.kind ? tx`and kind = ${opts.kind}` : tx``}
     order by name
  `;
  return rows.map(mapProduct);
}

export async function findProduct(tx: Tx, id: string, forUpdate = false): Promise<Product | null> {
  const rows = await tx.unsafe<ProductRow[]>(
    `select id, sku, name, size, category, cost_cents, replacement_price_cents, min_stock, active, kind, created_at
       from public.products where id = $1 and organization_id = app.current_org_id() and deleted_at is null
       ${forUpdate ? 'for update' : ''}`,
    [id],
  );
  return rows[0] ? mapProduct(rows[0]) : null;
}

export interface ProductWrite {
  sku?: string;
  name?: string;
  size?: string | null;
  category?: string | null;
  costCents?: number;
  replacementPriceCents?: number;
  minStock?: number;
  active?: boolean;
  kind?: ProductKind;
}

const PRODUCT_COLUMNS: Record<keyof ProductWrite, string> = {
  sku: 'sku',
  name: 'name',
  size: 'size',
  category: 'category',
  costCents: 'cost_cents',
  replacementPriceCents: 'replacement_price_cents',
  minStock: 'min_stock',
  active: 'active',
  kind: 'kind',
};

function productCols(p: ProductWrite) {
  return Object.fromEntries(
    Object.entries(p)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [PRODUCT_COLUMNS[k as keyof ProductWrite], v]),
  );
}

export async function insertProduct(tx: Tx, id: string, organizationId: string, p: ProductWrite) {
  await tx`insert into public.products ${tx({ id, organization_id: organizationId, ...productCols(p) })}`;
}

export async function updateProduct(tx: Tx, id: string, p: ProductWrite) {
  const cols = productCols(p);
  if (Object.keys(cols).length === 0) return;
  await tx`update public.products set ${tx(cols)} where id = ${id} and organization_id = app.current_org_id()`;
}

export interface MovementRow {
  id: string;
  organizationId: string;
  productId: string;
  type: MovementType;
  quantity: number;
  from: LedgerState;
  to: LedgerState;
  customerId: string | null;
  reason: string | null;
  reversesMovementId: string | null;
}

export async function insertMovementRow(
  tx: Tx,
  row: Record<string, unknown>,
): Promise<void> {
  await tx`insert into public.towel_movements ${tx(row)}`;
}

export interface BalanceRow {
  product_id: string;
  state: InventoryState;
  customer_id: string | null;
  quantity: number;
  last_delivery_at: Date | null;
  last_collection_at: Date | null;
}

export async function balancesForOrg(tx: Tx): Promise<BalanceRow[]> {
  return tx<BalanceRow[]>`
    select product_id, state, customer_id, quantity, last_delivery_at, last_collection_at
      from public.stock_balances where organization_id = app.current_org_id() and quantity <> 0
  `;
}

export async function balanceOf(tx: Tx, productId: string, state: LedgerState, customerId: string | null): Promise<number> {
  if (state === 'EXTERNAL') return 0;
  const [row] = await tx<{ quantity: number }[]>`
    select quantity from public.stock_balances
     where organization_id = app.current_org_id() and product_id = ${productId} and state = ${state}
       and customer_key = coalesce(${state === 'WITH_CUSTOMER' ? customerId : null}::uuid, '00000000-0000-0000-0000-000000000000')
  `;
  return row?.quantity ?? 0;
}

export async function customerBalances(tx: Tx, customerId: string) {
  return tx<
    { product_id: string; sku: string; name: string; quantity: number; replacement_price_cents: string; last_delivery_at: Date | null; last_collection_at: Date | null }[]
  >`
    select b.product_id, p.sku, p.name, b.quantity, p.replacement_price_cents, b.last_delivery_at, b.last_collection_at
      from public.stock_balances b
      join public.products p on p.id = b.product_id
     where b.organization_id = app.current_org_id() and b.state = 'WITH_CUSTOMER' and b.customer_id = ${customerId}
     order by p.name
  `;
}

export async function findMovement(tx: Tx, id: string): Promise<(MovementRow & { reversed: boolean }) | null> {
  const [r] = await tx<Record<string, unknown>[]>`
    select m.id, m.organization_id, m.product_id, m.movement_type, m.quantity, m.from_state, m.to_state, m.customer_id,
           m.reason, m.reverses_movement_id,
           exists (select 1 from public.towel_movements x where x.reverses_movement_id = m.id) as reversed
      from public.towel_movements m where m.id = ${id} and m.organization_id = app.current_org_id()
  `;
  if (!r) return null;
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    productId: r.product_id as string,
    type: r.movement_type as MovementType,
    quantity: r.quantity as number,
    from: r.from_state as LedgerState,
    to: r.to_state as LedgerState,
    customerId: (r.customer_id as string) ?? null,
    reason: (r.reason as string) ?? null,
    reversesMovementId: (r.reverses_movement_id as string) ?? null,
    reversed: r.reversed as boolean,
  };
}

export interface MovementListFilters {
  productId?: string;
  customerId?: string;
  type?: MovementType;
  cursor?: { ts: string; id: string };
  limit: number;
}

export async function listMovements(tx: Tx, f: MovementListFilters) {
  return tx<Record<string, unknown>[]>`
    select m.id, m.movement_type, m.quantity, m.from_state, m.to_state, m.customer_id, m.product_id,
           m.order_id, m.route_id, m.reason, m.reverses_movement_id, m.actor_type, m.actor_id, m.occurred_at,
           m.occurred_at::text as cursor_ts, p.sku, p.name as product_name,
           coalesce(c.trade_name, c.legal_name) as customer_name, pr.full_name as actor_name,
           exists (select 1 from public.towel_movements x where x.reverses_movement_id = m.id) as reversed
      from public.towel_movements m
      join public.products p on p.id = m.product_id
      left join public.customers c on c.id = m.customer_id
      left join public.profiles pr on pr.id = m.actor_id and m.actor_type = 'USER'
     where m.organization_id = app.current_org_id()
       ${f.productId ? tx`and m.product_id = ${f.productId}` : tx``}
       ${f.customerId ? tx`and m.customer_id = ${f.customerId}` : tx``}
       ${f.type ? tx`and m.movement_type = ${f.type}` : tx``}
       ${f.cursor ? tx`and (m.occurred_at, m.id) < (${f.cursor.ts}::timestamptz, ${f.cursor.id}::uuid)` : tx``}
     order by m.occurred_at desc, m.id desc
     limit ${f.limit}
  `;
}
