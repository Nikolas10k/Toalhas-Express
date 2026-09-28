import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { toDbContext, type AuthenticatedActor, type UserActor } from '@/server/auth/actor';
import { authorize, hasPermission } from '@/server/authz/authorize';
import { AuthorizationError, BusinessRuleError, InventoryError, NotFoundError, ValidationError } from '@/server/core/errors';
import { logger } from '@/server/core/logger';
import type { Tx } from '@/server/db/client';
import { withActorTransaction, withSystemTransaction } from '@/server/db/transaction';
import { recordAudit } from '@/server/modules/audit/audit.service';
import { executeIdempotent } from '@/server/modules/idempotency/idempotency.service';
import { recordMovements } from '@/server/modules/inventory/inventory.service';
import { recordOutboxEvent } from '@/server/modules/outbox/outbox.service';
import {
  MANUAL_TRANSITIONS,
  ORDER_STATUSES,
  assertCanCancel,
  formatOrderNumber,
  isManualTransition,
  orderStateMachine,
  requiresReason,
  reservationEffect,
  todayInSaoPaulo,
  validateItems,
  type OrderItemInput,
  type OrderStatus,
  type OrderType,
} from './orders.domain';
import {
  countOrdersByStatus,
  findOrder,
  listOrders,
  orderHistory,
  orderItems,
  reservedByOrder,
  type OrderRow,
} from './orders.repository';

// -----------------------------------------------------------------------------
// Schemas (intenção do cliente; valores finais são calculados aqui)
// -----------------------------------------------------------------------------

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.');
const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido (HH:MM).')
  .nullable()
  .optional()
  .transform((v) => v || null);

export const orderItemSchema = z.strictObject({
  productId: z.uuid(),
  deliveryQuantity: z.number().int().min(0).max(100000).default(0),
  collectionQuantity: z.number().int().min(0).max(100000).default(0),
});

const baseOrder = {
  type: z.enum(['DELIVERY', 'COLLECTION', 'DELIVERY_AND_COLLECTION']),
  scheduledDate: isoDate,
  windowStart: hhmm,
  windowEnd: hhmm,
  items: z.array(orderItemSchema).min(1).max(20),
  notes: z.string().trim().max(1000).nullable().optional().transform((v) => v || null),
};

export const staffOrderSchema = z.strictObject({
  ...baseOrder,
  customerId: z.uuid(),
  internalNotes: z.string().trim().max(1000).nullable().optional().transform((v) => v || null),
  assignedTo: z.uuid().nullable().optional(),
  confirmNow: z.boolean().default(false),
});
export const portalOrderSchema = z.strictObject(baseOrder);
export const integrationOrderSchema = z.strictObject({
  ...baseOrder,
  customerId: z.uuid().optional(),
  /** Telefone/WhatsApp de quem pediu (n8n). Usado para achar o cliente quando não há ID. */
  customerPhone: z.string().trim().max(30).optional(),
});

export const transitionSchema = z.strictObject({
  to: z.enum(ORDER_STATUSES),
  reason: z.string().trim().max(500).optional(),
  scheduledDate: isoDate.optional(),
  windowStart: hhmm,
  windowEnd: hhmm,
  /** Confirmar mesmo sem estoque (exige order.override_stock, motivo e step-up). */
  overrideStock: z.boolean().default(false),
});
export type TransitionInput = z.infer<typeof transitionSchema>;

// -----------------------------------------------------------------------------
// Criação
// -----------------------------------------------------------------------------

type Source = 'ADMIN' | 'PORTAL' | 'INTEGRATION';

interface CreateArgs {
  customerId: string;
  type: OrderType;
  scheduledDate: string;
  windowStart: string | null;
  windowEnd: string | null;
  items: OrderItemInput[];
  notes: string | null;
  internalNotes?: string | null;
  assignedTo?: string | null;
  status: 'DRAFT' | 'NEW';
  source: Source;
}

function checkWindow(start: string | null, end: string | null) {
  if (start && end && end <= start) throw new ValidationError('O fim da janela deve ser depois do início.', [{ path: 'windowEnd', message: 'inválido' }]);
}

async function insertOrder(tx: Tx, actor: AuthenticatedActor, a: CreateArgs): Promise<{ id: string; number: string }> {
  validateItems(a.type, a.items);
  checkWindow(a.windowStart, a.windowEnd);
  if (a.scheduledDate < todayInSaoPaulo()) throw new BusinessRuleError('A data do pedido não pode ser no passado.');

  type CustomerSnap = { id: string; status: string; anonymized_at: Date | null; street: string | null; number: string | null; complement: string | null; district: string | null; city: string | null; state: string | null; postal_code: string | null; latitude: number | null; longitude: number | null };
  const readCustomer = (q: Tx) => q<CustomerSnap[]>`
    select id, status, anonymized_at, street, number, complement, district, city, state, postal_code,
           latitude::float8 as latitude, longitude::float8 as longitude
      from public.customers where id = ${a.customerId} and organization_id = ${actor.organizationId} and deleted_at is null
  `;
  // Integração não lê clientes via RLS: consulta de sistema estreita, sempre filtrada pela org do token.
  const [customer] = actor.type === 'INTEGRATION' ? await withSystemTransaction(readCustomer) : await readCustomer(tx);
  if (!customer) throw new NotFoundError('Cliente não encontrado.');
  if (customer.anonymized_at) throw new BusinessRuleError('Cliente anonimizado não pode receber pedidos.');
  if (a.status !== 'DRAFT' && customer.status !== 'active') {
    throw new BusinessRuleError(
      customer.status === 'pending' ? 'Cadastro do cliente aguardando aprovação.' : 'Cliente não está ativo para novos pedidos.',
    );
  }

  const productIds = a.items.map((i) => i.productId);
  const products = await tx<{ id: string }[]>`
    select id from public.products where organization_id = app.current_org_id() and active and deleted_at is null and id = any (${productIds})
  `;
  if (products.length !== productIds.length) throw new BusinessRuleError('Produto inválido ou inativo nos itens.');

  const id = randomUUID();
  const [{ n }] = (await tx`select app.next_order_number(${actor.organizationId}) as n`) as unknown as [{ n: string }];
  await tx`
    insert into public.orders (id, organization_id, number, customer_id, order_type, status, scheduled_date, window_start, window_end,
                               address, latitude, longitude, notes, internal_notes, assigned_to, source, created_by)
    values (${id}, ${actor.organizationId}, ${n}, ${a.customerId}, ${a.type}, ${a.status}, ${a.scheduledDate}, ${a.windowStart}, ${a.windowEnd},
            ${tx.json({
              street: customer.street, number: customer.number, complement: customer.complement, district: customer.district,
              city: customer.city, state: customer.state, postalCode: customer.postal_code,
            })},
            ${customer.latitude}, ${customer.longitude}, ${a.notes}, ${a.internalNotes ?? null}, ${a.assignedTo ?? null}, ${a.source},
            ${actor.type === 'USER' ? actor.userId : actor.tokenId})
  `;
  for (const it of a.items) {
    await tx`
      insert into public.order_items (organization_id, order_id, product_id, delivery_quantity, collection_quantity)
      values (${actor.organizationId}, ${id}, ${it.productId}, ${it.deliveryQuantity}, ${it.collectionQuantity})
    `;
  }
  await insertHistory(tx, actor, id, null, a.status, null, { source: a.source });
  await recordAudit(tx, actor, actor.organizationId, {
    action: 'order.created',
    entityType: 'order',
    entityId: id,
    after: { number: n, customer_id: a.customerId, type: a.type, status: a.status, scheduled_date: a.scheduledDate, items: a.items },
    metadata: { source: a.source },
  });
  await recordOutboxEvent(tx, {
    organizationId: actor.organizationId,
    eventType: 'OrderCreated',
    aggregateType: 'order',
    aggregateId: id,
    payload: { order_id: id, number: n, customer_id: a.customerId, status: a.status, source: a.source },
    idempotencyKey: `OrderCreated:${id}`,
  });
  return { id, number: n };
}

async function insertHistory(
  tx: Tx,
  actor: AuthenticatedActor,
  orderId: string,
  from: OrderStatus | null,
  to: OrderStatus,
  reason: string | null,
  metadata: Record<string, unknown> = {},
) {
  await tx`
    insert into public.order_status_history (organization_id, order_id, from_status, to_status, reason, metadata, actor_type, actor_id, created_at)
    values (${actor.organizationId}, ${orderId}, ${from}, ${to}, ${reason}, ${tx.json(metadata as never)}, ${actor.type},
            ${actor.type === 'USER' ? actor.userId : actor.tokenId}, clock_timestamp())
  `;
}

export async function createOrderByStaff(actor: UserActor, input: z.infer<typeof staffOrderSchema>, idempotencyKey?: string) {
  authorize(actor, 'order.create');
  if (input.confirmNow) authorize(actor, 'order.update');
  const run = async (tx: Tx) => {
    const created = await insertOrder(tx, actor, { ...input, items: input.items, status: 'NEW', source: 'ADMIN' });
    if (input.confirmNow) await applyTransition(tx, actor, created.id, { to: 'CONFIRMED', overrideStock: false, windowStart: null, windowEnd: null });
    return { id: created.id, number: created.number };
  };
  if (idempotencyKey) return (await executeIdempotent(actor, { scope: 'order.create', key: idempotencyKey, request: input }, run)).result;
  return withActorTransaction(toDbContext(actor), run);
}

async function ownCustomerId(tx: Tx): Promise<string> {
  const [row] = await tx<{ ids: string[] }[]>`select app.current_customer_ids() as ids`;
  const id = row?.ids[0];
  if (!id) throw new AuthorizationError('Usuário sem cadastro de cliente vinculado.');
  return id;
}

export async function createOrderByCustomer(actor: UserActor, input: z.infer<typeof portalOrderSchema>, idempotencyKey: string) {
  authorize(actor, 'portal.access');
  const { result } = await executeIdempotent(actor, { scope: 'order.portal_create', key: idempotencyKey, request: input }, async (tx) => {
    // O cliente nunca escolhe o customer_id: vem do vínculo do usuário.
    const customerId = await ownCustomerId(tx);
    const created = await insertOrder(tx, actor, { ...input, customerId, status: 'NEW', source: 'PORTAL' });
    return { id: created.id, number: created.number };
  });
  return result;
}

/** n8n: cria pedido em rascunho para confirmação humana. Sempre idempotente. */
export async function createDraftOrderByIntegration(
  actor: AuthenticatedActor,
  input: z.infer<typeof integrationOrderSchema>,
  idempotencyKey: string,
) {
  authorize(actor, 'order.create_draft');
  const { result, replayed } = await executeIdempotent(actor, { scope: 'order.draft', key: idempotencyKey, request: input }, async (tx) => {
    let customerId = input.customerId;
    if (!customerId && input.customerPhone) {
      const { normalizePhone } = await import('@/lib/br/phone');
      const phone = normalizePhone(input.customerPhone);
      if (!phone) throw new ValidationError('Telefone inválido.');
      const found = await withSystemTransaction(
        (stx) => stx<{ id: string }[]>`
          select id from public.customers
           where organization_id = ${actor.organizationId} and deleted_at is null and anonymized_at is null
             and (whatsapp = ${phone} or phone = ${phone})
           limit 2`,
      );
      if (found.length !== 1) throw new NotFoundError(found.length ? 'Mais de um cliente com este telefone.' : 'Cliente não encontrado pelo telefone.');
      customerId = found[0]!.id;
    }
    if (!customerId) throw new ValidationError('Informe customerId ou customerPhone.');
    // Integração não enxerga clientes via RLS: valida vínculo com a org em contexto de sistema.
    const created = await insertDraftAsSystemChecked(tx, actor, { ...input, customerId });
    return { id: created.id, number: created.number };
  });
  return { ...result, replayed };
}

async function insertDraftAsSystemChecked(tx: Tx, actor: AuthenticatedActor, input: z.infer<typeof integrationOrderSchema> & { customerId: string }) {
  return insertOrder(tx, actor, {
    customerId: input.customerId,
    type: input.type,
    scheduledDate: input.scheduledDate,
    windowStart: input.windowStart ?? null,
    windowEnd: input.windowEnd ?? null,
    items: input.items,
    notes: input.notes ?? null,
    status: 'DRAFT',
    source: 'INTEGRATION',
  });
}

// -----------------------------------------------------------------------------
// Transições (com reserva/liberação de estoque na MESMA transação)
// -----------------------------------------------------------------------------

async function reserve(tx: Tx, actor: AuthenticatedActor, order: OrderRow, historyTag: string, allowNegative: boolean) {
  const items = await orderItems(tx, order.id);
  const reserved = await reservedByOrder(tx, order.id);
  const movements = items
    .map((i) => ({ i, missing: i.delivery_quantity - (reserved.get(i.product_id) ?? 0) }))
    .filter((x) => x.missing > 0)
    .map(({ i, missing }) => ({
      productId: i.product_id,
      type: 'RESERVATION' as const,
      quantity: missing,
      from: 'AVAILABLE' as const,
      to: 'RESERVED' as const,
      customerId: order.customer_id,
      orderId: order.id,
      allowNegative,
      reason: allowNegative ? 'Confirmação com estoque insuficiente (override autorizado)' : null,
      idempotencyKey: `order:${order.id}:reserve:${historyTag}:${i.product_id}`,
    }));
  if (movements.length) await recordMovements(tx, actor, movements);
  return movements.reduce((a, m) => a + m.quantity, 0);
}

async function release(tx: Tx, actor: AuthenticatedActor, order: OrderRow, historyTag: string) {
  const reserved = await reservedByOrder(tx, order.id);
  const movements = [...reserved.entries()]
    .filter(([, q]) => q > 0)
    .map(([productId, q]) => ({
      productId,
      type: 'RESERVATION_RELEASE' as const,
      quantity: q,
      from: 'RESERVED' as const,
      to: 'AVAILABLE' as const,
      customerId: order.customer_id,
      orderId: order.id,
      idempotencyKey: `order:${order.id}:release:${historyTag}:${productId}`,
    }));
  if (movements.length) await recordMovements(tx, actor, movements);
  return movements.reduce((a, m) => a + m.quantity, 0);
}

interface TransitionResult {
  status: OrderStatus;
  reserved: number;
  released: number;
  override: boolean;
}

/**
 * Aplica uma transição dentro da transação do chamador: valida a tabela,
 * reserva/libera estoque com lock, grava histórico, auditoria e outbox.
 */
export async function applyTransition(tx: Tx, actor: AuthenticatedActor, orderId: string, input: TransitionInput): Promise<TransitionResult> {
  const order = await findOrder(tx, orderId, true);
  if (!order) throw new NotFoundError('Pedido não encontrado.');
  const from = order.status;
  const to = input.to;
  if (to === 'CANCELLED') assertCanCancel(from);
  orderStateMachine.assertTransition(from, to);
  const reason = input.reason?.trim() || null;
  if (requiresReason(to) && (!reason || reason.length < 3)) throw new ValidationError('Informe o motivo.', [{ path: 'reason', message: 'obrigatório' }]);

  if (to === 'CONFIRMED' && order.customer_status !== 'active') {
    throw new BusinessRuleError('Cliente não está ativo: aprove ou reative o cadastro antes de confirmar.');
  }

  let newDate: string | null = null;
  if (to === 'RESCHEDULED') {
    if (!input.scheduledDate) throw new ValidationError('Informe a nova data.', [{ path: 'scheduledDate', message: 'obrigatório' }]);
    if (input.scheduledDate < todayInSaoPaulo()) throw new BusinessRuleError('A nova data não pode ser no passado.');
    checkWindow(input.windowStart ?? null, input.windowEnd ?? null);
    newDate = input.scheduledDate;
  }

  const tag = randomUUID();
  let reserved = 0;
  let released = 0;
  let override = false;
  const effect = reservationEffect(from, to);
  if (effect === 'reserve') {
    try {
      await tx.savepoint(async (sp) => {
        reserved = await reserve(sp as unknown as Tx, actor, order, tag, false);
      });
    } catch (err) {
      if (!(err instanceof InventoryError)) throw err;
      if (!input.overrideStock) {
        throw new InventoryError('Estoque insuficiente para confirmar este pedido.', { ...err.details, can_override: true });
      }
      authorize(actor, 'order.override_stock');
      if (!reason || reason.length < 5) throw new ValidationError('Informe o motivo para confirmar sem estoque.');
      reserved = await reserve(tx, actor, order, tag, true);
      override = true;
    }
  } else if (effect === 'release') {
    released = await release(tx, actor, order, tag);
  }

  await tx`
    update public.orders
       set status = ${to}, status_reason = ${reason}, status_changed_at = now(),
           stock_override = stock_override or ${override},
           scheduled_date = coalesce(${newDate}::date, scheduled_date),
           window_start = case when ${newDate}::date is null then window_start else ${input.windowStart ?? null}::time end,
           window_end = case when ${newDate}::date is null then window_end else ${input.windowEnd ?? null}::time end,
           -- Reagendado/cancelado sai da rota (a parada guarda o histórico).
           route_id = case when ${to} in ('RESCHEDULED', 'CANCELLED') then null else route_id end,
           driver_id = case when ${to} in ('RESCHEDULED', 'CANCELLED') then null else driver_id end
     where id = ${orderId}
  `;
  await insertHistory(tx, actor, orderId, from, to, reason, {
    ...(newDate ? { scheduled_date: newDate, previous_date: order.scheduled_date } : {}),
    ...(reserved ? { reserved } : {}),
    ...(released ? { released } : {}),
    ...(override ? { stock_override: true } : {}),
  });
  await recordAudit(tx, actor, actor.organizationId, {
    action: override ? 'order.confirmed_with_stock_override' : 'order.status_changed',
    entityType: 'order',
    entityId: orderId,
    before: { status: from, scheduled_date: order.scheduled_date },
    after: { status: to, ...(newDate ? { scheduled_date: newDate } : {}) },
    metadata: { reason, reserved, released },
  });
  await recordOutboxEvent(tx, {
    organizationId: actor.organizationId,
    eventType: to === 'CONFIRMED' ? 'OrderConfirmed' : to === 'CANCELLED' ? 'OrderCancelled' : 'OrderStatusChanged',
    aggregateType: 'order',
    aggregateId: orderId,
    payload: { order_id: orderId, number: order.number, customer_id: order.customer_id, from, to, scheduled_date: newDate ?? order.scheduled_date },
    idempotencyKey: `OrderStatus:${orderId}:${tag}`,
  });
  return { status: to, reserved, released, override };
}

/** Transição manual pela tela de pedidos. */
export async function transitionOrder(actor: UserActor, orderId: string, input: TransitionInput) {
  authorize(actor, input.to === 'CANCELLED' ? 'order.cancel' : 'order.update');
  const result = await withActorTransaction(toDbContext(actor), async (tx) => {
    const current = await findOrder(tx, orderId);
    if (!current) throw new NotFoundError('Pedido não encontrado.');
    if (!isManualTransition(current.status, input.to)) {
      throw new BusinessRuleError(`A mudança ${current.status} → ${input.to} é feita pelo fluxo de rotas/entregas, não manualmente.`);
    }
    return applyTransition(tx, actor, orderId, input);
  });
  if (result.override) await openOverrideAlert(actor.organizationId, orderId).catch((e) => logger.error('order.override_alert_failed', { error: e }));
  return result;
}

async function openOverrideAlert(organizationId: string, orderId: string) {
  await withSystemTransaction(async (tx) => {
    const [o] = await tx<{ number: string }[]>`select number::text from public.orders where id = ${orderId}`;
    await tx`
      insert into public.system_alerts (organization_id, alert_type, severity, title, details, dedupe_key)
      values (${organizationId}, 'STOCK_OVERRIDE', 'WARNING',
              ${`Pedido ${formatOrderNumber(o?.number ?? '')} confirmado sem estoque suficiente`},
              ${tx.json({ order_id: orderId })}, ${`STOCK_OVERRIDE:${orderId}`})
      on conflict (organization_id, dedupe_key) where status <> 'RESOLVED' do nothing
    `;
  });
}

/** Portal: o cliente cancela o próprio pedido apenas enquanto NEW (ainda sem reserva). */
export async function cancelOwnOrder(actor: UserActor, orderId: string, reason: string) {
  authorize(actor, 'portal.access');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const customerId = await ownCustomerId(tx);
    const order = await findOrder(tx, orderId, true);
    if (!order || order.customer_id !== customerId) throw new NotFoundError('Pedido não encontrado.');
    if (order.status !== 'NEW') {
      throw new BusinessRuleError('Este pedido já foi confirmado. Para cancelar, fale com a Toalhas Express.');
    }
    return applyTransition(tx, actor, orderId, { to: 'CANCELLED', reason: `Cancelado pelo cliente: ${reason}`, overrideStock: false, windowStart: null, windowEnd: null });
  });
}

// -----------------------------------------------------------------------------
// Consultas
// -----------------------------------------------------------------------------

export const orderListQuerySchema = z.strictObject({
  status: z.enum(ORDER_STATUSES).optional(),
  customerId: z.uuid().optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
});

function orderDto(o: OrderRow) {
  return {
    id: o.id,
    number: formatOrderNumber(o.number),
    customerId: o.customer_id,
    customerName: o.customer_name,
    type: o.order_type,
    status: o.status,
    scheduledDate: o.scheduled_date,
    windowStart: o.window_start,
    windowEnd: o.window_end,
    address: o.address,
    latitude: o.latitude,
    longitude: o.longitude,
    notes: o.notes,
    assignedTo: o.assigned_to,
    assignedName: o.assigned_name,
    source: o.source,
    recurring: Boolean(o.recurring_rule_id),
    stockOverride: o.stock_override,
    statusReason: o.status_reason,
    statusChangedAt: o.status_changed_at.toISOString(),
    createdAt: o.created_at.toISOString(),
  };
}

export async function listOrdersForActor(actor: AuthenticatedActor, q: z.infer<typeof orderListQuerySchema>) {
  authorize(actor, 'order.read');
  const pageSize = 30;
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const rows = await listOrders(tx, { ...q, offset: (q.page - 1) * pageSize, limit: pageSize + 1 });
    return {
      items: rows.slice(0, pageSize).map((r) => ({ ...orderDto(r), totalDelivery: r.total_delivery, totalCollection: r.total_collection })),
      hasMore: rows.length > pageSize,
      counts: q.page === 1 ? await countOrdersByStatus(tx, { dateFrom: q.dateFrom, dateTo: q.dateTo }) : undefined,
    };
  });
}

export async function getOrderDetail(actor: UserActor, orderId: string) {
  const staff = hasPermission(actor, 'order.read');
  if (!staff) authorize(actor, 'portal.access');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const o = await findOrder(tx, orderId);
    if (!o) throw new NotFoundError('Pedido não encontrado.');
    const items = await orderItems(tx, orderId);
    const reserved = staff ? await reservedByOrder(tx, orderId) : new Map<string, number>();
    const history = await orderHistory(tx, orderId);
    const manual = (MANUAL_TRANSITIONS[o.status] ?? []).filter((to) =>
      to === 'CANCELLED' ? hasPermission(actor, 'order.cancel') : hasPermission(actor, 'order.update'),
    );
    const dto = orderDto(o);
    // Cliente vê só motivos voltados a ele (cancelar/reagendar/problema); o resto é interno.
    const publicReason = (to: string, r: string | null) => (staff || requiresReason(to as OrderStatus) ? r : null);
    return {
      order: staff
        ? { ...dto, internalNotes: o.internal_notes }
        : { ...dto, stockOverride: false, assignedTo: null, assignedName: null, statusReason: publicReason(o.status, o.status_reason) },
      items: items.map((i) => ({
        productId: i.product_id,
        sku: i.sku,
        name: i.name,
        deliveryQuantity: i.delivery_quantity,
        collectionQuantity: i.collection_quantity,
        reservedQuantity: reserved.get(i.product_id) ?? 0,
      })),
      history: history.map((h) => ({
        id: h.id,
        from: h.from_status,
        to: h.to_status,
        reason: publicReason(h.to_status, h.reason),
        metadata: staff ? h.metadata : typeof h.metadata.scheduled_date === 'string' ? { scheduled_date: h.metadata.scheduled_date } : {},
        actorType: h.actor_type,
        actorName: staff ? h.actor_name : null,
        at: h.created_at.toISOString(),
      })),
      actions: staff ? manual : o.status === 'NEW' ? (['CANCELLED'] as OrderStatus[]) : [],
      canOverrideStock: hasPermission(actor, 'order.override_stock'),
    };
  });
}

export async function listOwnOrders(actor: UserActor) {
  authorize(actor, 'portal.access');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const customerId = await ownCustomerId(tx);
    const rows = await listOrders(tx, { customerId, offset: 0, limit: 100 });
    return rows.map((r) => ({
      ...orderDto(r),
      stockOverride: false,
      assignedTo: null,
      assignedName: null,
      statusReason: requiresReason(r.status) ? r.status_reason : null,
      totalDelivery: r.total_delivery,
      totalCollection: r.total_collection,
    }));
  });
}
