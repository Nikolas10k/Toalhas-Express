import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { toDbContext, type AuthenticatedActor, type UserActor } from '@/server/auth/actor';
import { authorize } from '@/server/authz/authorize';
import { BusinessRuleError, ConflictError, InventoryError, NotFoundError, ValidationError } from '@/server/core/errors';
import { multiplyCents, type Cents } from '@/server/core/money';
import { getRequestContext } from '@/server/core/request-context';
import type { Tx } from '@/server/db/client';
import { isUniqueViolation, withActorTransaction } from '@/server/db/transaction';
import { recordAudit } from '@/server/modules/audit/audit.service';
import {
  INVENTORY_STATES,
  LARGE_ADJUSTMENT_THRESHOLD,
  MOVEMENT_PERMISSION,
  MOVEMENT_TYPES,
  REVERSIBLE_TYPES,
  reverseOf,
  summarizeStock,
  validateMovement,
  type InventoryState,
  type MovementInput,
} from './inventory.domain';
import {
  balanceOf,
  balancesForOrg,
  customerBalances,
  findMovement,
  findProduct,
  insertMovementRow,
  insertProduct,
  listMovements,
  listProducts,
  updateProduct,
  type Product,
  type ProductWrite,
} from './inventory.repository';

// -----------------------------------------------------------------------------
// Núcleo: gravação de movimentos (usado por esta e pelas próximas fases)
// -----------------------------------------------------------------------------

/**
 * Grava movimentos DENTRO da transação do chamador (pedido, entrega, coleta,
 * lavanderia...). Valida regras do domínio e permissões por tipo; o trigger
 * aplica os saldos com lock de linha e impede saldo negativo. Movimento com
 * idempotency_key já gravada é ignorado (retry seguro).
 */
export async function recordMovements(tx: Tx, actor: AuthenticatedActor, inputs: MovementInput[]): Promise<{ inserted: string[]; skipped: number }> {
  let manualTotal = 0;
  for (const m of inputs) {
    validateMovement(m);
    authorize(actor, m.authorizedBy ?? MOVEMENT_PERMISSION[m.type]);
    if (m.type === 'MANUAL_ADJUSTMENT') manualTotal += m.quantity;
    if (m.allowNegative) authorize(actor, 'order.override_stock');
  }
  if (manualTotal > LARGE_ADJUSTMENT_THRESHOLD) authorize(actor, 'inventory.adjust_large');

  const inserted: string[] = [];
  let skipped = 0;
  const ctx = getRequestContext();
  for (const m of inputs) {
    const id = randomUUID();
    try {
      // Savepoint nativo do driver: uma falha isolada (ex.: chave repetida) não aborta a transação.
      await tx.savepoint((sp) => insertMovementRow(sp as unknown as Tx, {
        id,
        organization_id: actor.organizationId,
        product_id: m.productId,
        movement_type: m.type,
        quantity: m.quantity,
        from_state: m.from,
        to_state: m.to,
        customer_id: m.customerId ?? null,
        order_id: m.orderId ?? null,
        route_id: m.routeId ?? null,
        route_stop_id: m.routeStopId ?? null,
        driver_id: m.driverId ?? null,
        laundry_batch_id: m.laundryBatchId ?? null,
        reason: m.reason ?? null,
        allow_negative: m.allowNegative ?? false,
        reverses_movement_id: m.reversesMovementId ?? null,
        actor_type: actor.type,
        actor_id: actor.type === 'USER' ? actor.userId : actor.tokenId,
        idempotency_key: m.idempotencyKey ?? null,
        correlation_id: ctx?.correlationId ?? null,
        occurred_at: m.occurredAt ?? new Date(),
      }));
      inserted.push(id);
    } catch (err) {
      if (isUniqueViolation(err, 'towel_movements_idempotency_key_key')) {
        skipped += 1;
        continue;
      }
      const e = err as { code?: string; message?: string };
      if (e.code === 'P0010') {
        throw new InventoryError('Estoque insuficiente para esta operação.', { reason: e.message });
      }
      if (e.code === '23503') throw new NotFoundError('Produto ou cliente não encontrado.');
      throw err;
    }
  }
  return { inserted, skipped };
}

// -----------------------------------------------------------------------------
// Produtos
// -----------------------------------------------------------------------------

const moneyCents = z.number().int().min(0).max(10_000_000_00);
export const productSchema = z.strictObject({
  sku: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9._-]{0,39}$/, 'SKU: letras, números, ponto, hífen ou _ (até 40).'),
  name: z.string().trim().min(2).max(120),
  size: z.string().trim().max(40).nullable().optional().transform((v) => v || null),
  category: z.string().trim().max(60).nullable().optional().transform((v) => v || null),
  costCents: moneyCents,
  replacementPriceCents: moneyCents,
  minStock: z.number().int().min(0).max(1_000_000),
  active: z.boolean().default(true),
  /** RENTAL = toalha de aluguel (estoque); LINEN = enxoval do cliente (higienização, sem estoque). */
  kind: z.enum(['RENTAL', 'LINEN']).default('RENTAL'),
});
export const productUpdateSchema = productSchema.partial().strict();
/** Cadastro pode já dar entrada no estoque (vira um movimento STOCK_ENTRY na mesma transação). */
export const createProductSchema = productSchema.extend({
  initialQuantity: z.number().int().min(0).max(100_000).default(0),
});

export function toProductDto(p: Product) {
  return { ...p, createdAt: p.createdAt.toISOString() };
}

export async function listProductsForActor(actor: AuthenticatedActor, includeInactive = false) {
  authorize(actor, 'product.read');
  return withActorTransaction(toDbContext(actor), async (tx) => (await listProducts(tx, { includeInactive })).map(toProductDto));
}

/** Catálogo do portal: só o necessário para pedir (sem custos nem preço de reposição). */
export async function listPortalCatalog(actor: UserActor) {
  authorize(actor, 'portal.access');
  return withActorTransaction(toDbContext(actor), async (tx) =>
    (await listProducts(tx, { includeInactive: false, kind: 'RENTAL' })).map((p) => ({ id: p.id, sku: p.sku, name: p.name })),
  );
}

export async function createProduct(
  actor: UserActor,
  input: Omit<z.infer<typeof productSchema>, 'kind'> & { kind?: z.infer<typeof productSchema>['kind']; initialQuantity?: number },
) {
  authorize(actor, 'product.manage');
  const { initialQuantity = 0, kind = 'RENTAL', ...rest } = input;
  const product = { ...rest, kind };
  if (product.kind === 'LINEN' && (initialQuantity > 0 || product.minStock > 0)) {
    throw new BusinessRuleError('Enxoval do cliente não tem estoque: deixe estoque inicial e mínimo em zero.');
  }
  if (initialQuantity > 0) authorize(actor, MOVEMENT_PERMISSION.STOCK_ENTRY);
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const id = randomUUID();
    try {
      await tx.savepoint((sp) => insertProduct(sp as unknown as Tx, id, actor.organizationId, product));
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError('Já existe um produto com este SKU.');
      throw err;
    }
    await recordAudit(tx, actor, actor.organizationId, { action: 'product.created', entityType: 'product', entityId: id, after: input });
    if (initialQuantity > 0) {
      // Entrada pelo ledger (nunca saldo direto): produto e estoque inicial gravam juntos ou nada grava.
      const { inserted } = await recordMovements(tx, actor, [
        {
          productId: id,
          type: 'STOCK_ENTRY',
          quantity: initialQuantity,
          from: 'EXTERNAL',
          to: 'AVAILABLE',
          reason: 'Estoque inicial no cadastro do produto',
          idempotencyKey: `product:${id}:initial`,
        },
      ]);
      await recordAudit(tx, actor, actor.organizationId, {
        action: 'inventory.stock_entry',
        entityType: 'towel_movement',
        entityId: inserted[0]!,
        after: { product_id: id, type: 'STOCK_ENTRY', quantity: initialQuantity, from: 'EXTERNAL', to: 'AVAILABLE' },
        metadata: { reason: 'Estoque inicial no cadastro do produto' },
      });
    }
    return { id };
  });
}

export async function updateProductForActor(actor: UserActor, id: string, patch: z.infer<typeof productUpdateSchema>) {
  authorize(actor, 'product.manage');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const current = await findProduct(tx, id, true);
    if (!current) throw new NotFoundError('Produto não encontrado.');
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      const old = (current as unknown as Record<string, unknown>)[k];
      if (old !== v) {
        before[k] = old;
        after[k] = v;
      }
    }
    if (Object.keys(after).length === 0) return { changed: false };
    const kind = (after.kind as string | undefined) ?? current.kind;
    if (kind === 'LINEN' && ((after.minStock as number | undefined) ?? current.minStock) > 0) {
      throw new BusinessRuleError('Enxoval do cliente não tem estoque mínimo.');
    }
    try {
      await tx.savepoint((sp) => updateProduct(sp as unknown as Tx, id, after as ProductWrite));
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError('Já existe um produto com este SKU.');
      if (err instanceof Error && /mudar de tipo/.test(err.message)) throw new BusinessRuleError('Produto com histórico não pode mudar de tipo.');
      throw err;
    }
    await recordAudit(tx, actor, actor.organizationId, { action: 'product.updated', entityType: 'product', entityId: id, before, after });
    return { changed: true };
  });
}

// -----------------------------------------------------------------------------
// Operações manuais de estoque (tela Estoque)
// -----------------------------------------------------------------------------

const quantity = z.number().int().min(1).max(1_000_000);
const reason = z.string().trim().min(5, 'Informe o motivo (mínimo 5 caracteres).').max(500);
const stateEnum = z.enum(INVENTORY_STATES);

export const stockOperationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('entry'), productId: z.uuid(), quantity, reason }),
  /** Ajuste de saldo: delta positivo entra no estado, negativo sai. */
  z.strictObject({
    kind: z.literal('adjust'),
    productId: z.uuid(),
    state: stateEnum,
    delta: z.number().int().min(-1_000_000).max(1_000_000).refine((v) => v !== 0, 'O ajuste não pode ser zero.'),
    customerId: z.uuid().nullable().optional(),
    reason,
  }),
  z.strictObject({
    kind: z.literal('move'),
    type: z.enum(['TRANSFER', 'DAMAGE', 'LOSS', 'DISCARD']),
    productId: z.uuid(),
    from: stateEnum,
    to: stateEnum,
    quantity,
    customerId: z.uuid().nullable().optional(),
    reason,
  }),
]);
export type StockOperation = z.infer<typeof stockOperationSchema>;

function toMovement(op: StockOperation): MovementInput {
  switch (op.kind) {
    case 'entry':
      return { productId: op.productId, type: 'STOCK_ENTRY', quantity: op.quantity, from: 'EXTERNAL', to: 'AVAILABLE', reason: op.reason };
    case 'adjust':
      return {
        productId: op.productId,
        type: 'MANUAL_ADJUSTMENT',
        quantity: Math.abs(op.delta),
        from: op.delta > 0 ? 'EXTERNAL' : op.state,
        to: op.delta > 0 ? op.state : 'EXTERNAL',
        customerId: op.state === 'WITH_CUSTOMER' ? (op.customerId ?? null) : null,
        reason: op.reason,
      };
    case 'move':
      return {
        productId: op.productId,
        type: op.type,
        quantity: op.quantity,
        from: op.from,
        to: op.to,
        customerId: op.from === 'WITH_CUSTOMER' || op.to === 'WITH_CUSTOMER' ? (op.customerId ?? null) : null,
        reason: op.reason,
      };
  }
}

export interface OperationPreview {
  productName: string;
  from: { state: string; before: number; after: number } | null;
  to: { state: string; before: number; after: number } | null;
  customerName: string | null;
  /** Valor de reposição envolvido (perdas/danos/ajustes que reduzem saldo de cliente). */
  replacementValueCents: Cents | null;
  requiresStepUp: boolean;
  blocked: string | null;
}

/** Mostra o impacto antes de confirmar (SPEC §13). Não grava nada. */
export async function previewStockOperation(actor: UserActor, op: StockOperation): Promise<OperationPreview> {
  const m = toMovement(op);
  validateMovement(m);
  authorize(actor, 'inventory.read');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const product = await findProduct(tx, m.productId);
    if (!product) throw new NotFoundError('Produto não encontrado.');
    let customerName: string | null = null;
    if (m.customerId) {
      const [c] = await tx<{ name: string }[]>`
        select coalesce(trade_name, legal_name) as name from public.customers where id = ${m.customerId} and organization_id = app.current_org_id()`;
      if (!c) throw new NotFoundError('Cliente não encontrado.');
      customerName = c.name;
    }
    const fromBefore = m.from === 'EXTERNAL' ? null : await balanceOf(tx, m.productId, m.from, m.customerId ?? null);
    const toBefore = m.to === 'EXTERNAL' ? null : await balanceOf(tx, m.productId, m.to, m.customerId ?? null);
    const leavesCustomer = m.from === 'WITH_CUSTOMER' && (m.type === 'LOSS' || m.type === 'DAMAGE' || m.type === 'MANUAL_ADJUSTMENT');
    return {
      productName: product.name,
      from: fromBefore === null ? null : { state: m.from, before: fromBefore, after: fromBefore - m.quantity },
      to: toBefore === null ? null : { state: m.to, before: toBefore, after: toBefore + m.quantity },
      customerName,
      replacementValueCents: leavesCustomer || m.type === 'LOSS' ? multiplyCents(product.replacementPriceCents, m.quantity) : null,
      requiresStepUp: m.type === 'MANUAL_ADJUSTMENT' && m.quantity > LARGE_ADJUSTMENT_THRESHOLD,
      blocked: fromBefore !== null && fromBefore - m.quantity < 0 ? `Saldo insuficiente: há ${fromBefore} no estado de origem.` : null,
    };
  });
}

export async function executeStockOperation(actor: UserActor, op: StockOperation, idempotencyKey?: string) {
  const m = { ...toMovement(op), idempotencyKey: idempotencyKey ? `stockop:${idempotencyKey}` : null };
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const { inserted, skipped } = await recordMovements(tx, actor, [m]);
    if (inserted[0]) {
      await recordAudit(tx, actor, actor.organizationId, {
        action: `inventory.${op.kind === 'move' ? op.type.toLowerCase() : op.kind === 'entry' ? 'stock_entry' : 'manual_adjustment'}`,
        entityType: 'towel_movement',
        entityId: inserted[0],
        after: { product_id: m.productId, type: m.type, quantity: m.quantity, from: m.from, to: m.to, customer_id: m.customerId ?? null },
        metadata: { reason: m.reason },
      });
    }
    return { movementId: inserted[0] ?? null, replayed: skipped > 0 };
  });
}

/** Estorno: novo movimento com estados invertidos (o original nunca é alterado). */
export async function reverseMovement(actor: UserActor, movementId: string, why: string) {
  authorize(actor, 'inventory.adjust');
  if (why.trim().length < 5) throw new ValidationError('Informe o motivo do estorno.');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${`reverse:${movementId}`}, 0))`;
    const original = await findMovement(tx, movementId);
    if (!original) throw new NotFoundError('Movimento não encontrado.');
    if (!REVERSIBLE_TYPES.includes(original.type)) throw new BusinessRuleError('Este tipo de movimento não pode ser estornado por aqui.');
    if (original.reversesMovementId) throw new BusinessRuleError('Um estorno não pode ser estornado. Registre um novo movimento.');
    if (original.reversed) throw new ConflictError('Este movimento já foi estornado.');
    const rev = reverseOf(original);
    const { inserted } = await recordMovements(tx, actor, [
      { ...rev, reason: `Estorno: ${why}`, reversesMovementId: original.id, idempotencyKey: `reverse:${original.id}` },
    ]);
    await recordAudit(tx, actor, actor.organizationId, {
      action: 'inventory.movement_reversed',
      entityType: 'towel_movement',
      entityId: original.id,
      after: { reversal_id: inserted[0] },
      metadata: { reason: why },
    });
    return { reversalId: inserted[0] ?? null };
  });
}

// -----------------------------------------------------------------------------
// Consultas
// -----------------------------------------------------------------------------

export async function getStockOverview(actor: AuthenticatedActor) {
  authorize(actor, 'inventory.read');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const products = await listProducts(tx, { includeInactive: true, kind: 'RENTAL' });
    const balances = await balancesForOrg(tx);
    const alerts = await tx<{ id: string; alert_type: string; severity: string; title: string; details: unknown; created_at: Date }[]>`
      select id, alert_type, severity, title, details, created_at from public.system_alerts
       where organization_id = app.current_org_id() and status <> 'RESOLVED'
         and alert_type in ('INVENTORY_INCONSISTENT', 'NEGATIVE_BALANCE', 'LOW_STOCK')
       order by created_at desc limit 50
    `;
    return {
      products: products.map((p) => {
        const stock = summarizeStock(balances.filter((b) => b.product_id === p.id) as { state: InventoryState; quantity: number }[]);
        return { ...toProductDto(p), stock, belowMinimum: p.active && stock.byState.AVAILABLE < p.minStock };
      }),
      alerts: alerts.map((a) => ({ id: a.id, type: a.alert_type, severity: a.severity, title: a.title, details: a.details, createdAt: a.created_at.toISOString() })),
    };
  });
}

export async function getCustomerBalances(actor: AuthenticatedActor, customerId: string) {
  authorize(actor, 'inventory.read');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const [c] = await tx`select 1 from public.customers where id = ${customerId} and organization_id = app.current_org_id()`;
    if (!c) throw new NotFoundError('Cliente não encontrado.');
    return mapCustomerBalances(await customerBalances(tx, customerId));
  });
}

function mapCustomerBalances(rows: Awaited<ReturnType<typeof customerBalances>>) {
  return rows
    .filter((r) => r.quantity !== 0)
    .map((r) => ({
      productId: r.product_id,
      sku: r.sku,
      name: r.name,
      quantity: r.quantity,
      replacementPriceCents: Number(r.replacement_price_cents),
      lastDeliveryAt: r.last_delivery_at?.toISOString() ?? null,
      lastCollectionAt: r.last_collection_at?.toISOString() ?? null,
    }));
}

/** Portal: toalhas em posse do próprio cliente (RLS garante o vínculo). */
export async function getOwnBalances(actor: UserActor) {
  authorize(actor, 'portal.access');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const [row] = await tx<{ ids: string[] }[]>`select app.current_customer_ids() as ids`;
    const id = row?.ids[0];
    if (!id) return [];
    return mapCustomerBalances(await customerBalances(tx, id));
  });
}

const CURSOR_TS = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)$/;

export const movementListQuerySchema = z.strictObject({
  productId: z.uuid().optional(),
  customerId: z.uuid().optional(),
  type: z.enum(MOVEMENT_TYPES).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function listMovementsForActor(actor: AuthenticatedActor, q: z.infer<typeof movementListQuerySchema>) {
  authorize(actor, 'inventory.read');
  let cursor: { ts: string; id: string } | undefined;
  if (q.cursor) {
    try {
      const [ts, id] = z.tuple([z.string().regex(CURSOR_TS), z.uuid()]).parse(JSON.parse(Buffer.from(q.cursor, 'base64url').toString('utf8')));
      cursor = { ts, id };
    } catch {
      throw new ValidationError('Cursor inválido.');
    }
  }
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const rows = await listMovements(tx, { productId: q.productId, customerId: q.customerId, type: q.type, cursor, limit: q.limit + 1 });
    const hasMore = rows.length > q.limit;
    const items = rows.slice(0, q.limit);
    const last = items.at(-1);
    return {
      items: items.map((r) => ({
        id: r.id as string,
        type: r.movement_type as string,
        quantity: r.quantity as number,
        from: r.from_state as string,
        to: r.to_state as string,
        productId: r.product_id as string,
        sku: r.sku as string,
        productName: r.product_name as string,
        customerId: (r.customer_id as string) ?? null,
        customerName: (r.customer_name as string) ?? null,
        orderId: (r.order_id as string) ?? null,
        reason: (r.reason as string) ?? null,
        reversesMovementId: (r.reverses_movement_id as string) ?? null,
        reversed: r.reversed as boolean,
        actorType: r.actor_type as string,
        actorName: (r.actor_name as string) ?? null,
        occurredAt: (r.occurred_at as Date).toISOString(),
      })),
      nextCursor: hasMore && last ? Buffer.from(JSON.stringify([last.cursor_ts, last.id])).toString('base64url') : null,
    };
  });
}
