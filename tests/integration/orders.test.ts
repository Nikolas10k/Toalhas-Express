import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { IntegrationActor, UserActor } from '@/server/auth/actor';
import { AuthorizationError, BusinessRuleError, InventoryError, NotFoundError, StepUpRequiredError, ValidationError } from '@/server/core/errors';
import { withActorTransaction } from '@/server/db/transaction';
import { resolveIntegrationActor, resolveUserActor } from '@/server/modules/access/access.service';
import { createCustomer, insertNewCustomer } from '@/server/modules/customers/customers.service';
import { linkCustomerUser } from '@/server/modules/customers/customers.repository';
import { createProduct, executeStockOperation, getStockOverview } from '@/server/modules/inventory/inventory.service';
import { addDays, todayInSaoPaulo } from '@/server/modules/orders/orders.domain';
import {
  applyTransition,
  cancelOwnOrder,
  createDraftOrderByIntegration,
  createOrderByCustomer,
  createOrderByStaff,
  getOrderDetail,
  listOrdersForActor,
  transitionOrder,
} from '@/server/modules/orders/orders.service';
import { createRecurringRule, generateRecurringOrders } from '@/server/modules/orders/recurrence.service';
import { customerCreateSchema } from '@/lib/validation/customers';
import { nextCnpj } from '../helpers/documents';
import { createIntegrationToken, createOrg, createUserInOrg, sql } from './fixtures';

let org: string;
let admin: UserActor;
let manager: UserActor;
let driver: UserActor;
let product: string;
let customer: string;
const today = todayInSaoPaulo();
const tomorrow = addDays(today, 1);

async function actor(roles: string[], mfa = false) {
  const { userId } = await createUserInOrg(org, roles);
  return (await resolveUserActor({ userId, aal: mfa ? 'aal2' : 'aal1', lastTotpAt: mfa ? Math.floor(Date.now() / 1000) : undefined }, org))!;
}

async function newCustomer(phone?: string) {
  const { id } = await createCustomer(
    admin,
    customerCreateSchema.parse({ personType: 'PJ', legalName: 'Barbearia Pedido', document: nextCnpj(), whatsapp: phone }),
  );
  return id;
}

async function stock() {
  const o = await getStockOverview(admin);
  return o.products.find((p) => p.id === product)!.stock.byState;
}

function order(qty: number, extra: Record<string, unknown> = {}) {
  return {
    customerId: customer,
    type: 'DELIVERY' as const,
    scheduledDate: tomorrow,
    windowStart: '08:00',
    windowEnd: '12:00',
    items: [{ productId: product, deliveryQuantity: qty, collectionQuantity: 0 }],
    notes: null,
    internalNotes: null,
    confirmNow: false,
    ...extra,
  };
}

beforeAll(async () => {
  org = await createOrg('ped');
  admin = await actor(['ADMIN'], true);
  manager = await actor(['MANAGER']);
  driver = await actor(['DRIVER']);
  ({ id: product } = await createProduct(admin, { sku: 'TOA-PED', name: 'Toalha pedido', size: null, category: null, costCents: 0, replacementPriceCents: 1500, minStock: 0, active: true }));
  await executeStockOperation(admin, { kind: 'entry', productId: product, quantity: 100, reason: 'Estoque inicial' });
  customer = await newCustomer('+5511987650000');
});

describe('pedidos: criação e reserva', () => {
  it('confirmar reserva o estoque; cancelar libera', async () => {
    const before = await stock();
    const { id, number } = await createOrderByStaff(manager, order(30));
    expect(number).toMatch(/^\d+$/);
    await transitionOrder(manager, id, { to: 'CONFIRMED', overrideStock: false, windowStart: null, windowEnd: null });
    let s = await stock();
    expect(s.AVAILABLE).toBe(before.AVAILABLE - 30);
    expect(s.RESERVED).toBe(before.RESERVED + 30);
    const detail = await getOrderDetail(manager, id);
    expect(detail.items[0]!.reservedQuantity).toBe(30);
    expect(detail.history.map((h) => h.to)).toEqual(['NEW', 'CONFIRMED']);

    await expect(transitionOrder(manager, id, { to: 'CANCELLED', overrideStock: false, windowStart: null, windowEnd: null })).rejects.toBeInstanceOf(ValidationError);
    await transitionOrder(manager, id, { to: 'CANCELLED', reason: 'Cliente desistiu', overrideStock: false, windowStart: null, windowEnd: null });
    s = await stock();
    expect(s.AVAILABLE).toBe(before.AVAILABLE);
    expect(s.RESERVED).toBe(before.RESERVED);
    const events = await sql`select event_type from public.outbox_events where aggregate_id = ${id} order by created_at`;
    expect(events.map((e) => e.event_type)).toEqual(['OrderCreated', 'OrderConfirmed', 'OrderCancelled']);
  });

  it('sem estoque suficiente a confirmação é bloqueada e nada muda', async () => {
    const before = await stock();
    const { id } = await createOrderByStaff(manager, order(before.AVAILABLE + 1));
    const err = await transitionOrder(manager, id, { to: 'CONFIRMED', overrideStock: false, windowStart: null, windowEnd: null }).catch((e) => e);
    expect(err).toBeInstanceOf(InventoryError);
    expect(err.publicMessage).toMatch(/Estoque insuficiente/);
    expect((await getOrderDetail(manager, id)).order.status).toBe('NEW');
    expect((await stock()).RESERVED).toBe(before.RESERVED);
  });

  it('override: gerente não pode; admin com step-up e motivo confirma, audita e gera alerta', async () => {
    const before = await stock();
    const { id } = await createOrderByStaff(admin, order(before.AVAILABLE + 5));
    await expect(
      transitionOrder(manager, id, { to: 'CONFIRMED', reason: 'urgente', overrideStock: true, windowStart: null, windowEnd: null }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    const stale: UserActor = { ...admin, mfa: { ...admin.mfa, lastTotpAt: 1 } };
    await expect(
      transitionOrder(stale, id, { to: 'CONFIRMED', reason: 'Cliente VIP urgente', overrideStock: true, windowStart: null, windowEnd: null }),
    ).rejects.toBeInstanceOf(StepUpRequiredError);
    const r = await transitionOrder(admin, id, { to: 'CONFIRMED', reason: 'Cliente VIP urgente', overrideStock: true, windowStart: null, windowEnd: null });
    expect(r.override).toBe(true);
    expect((await stock()).AVAILABLE).toBe(-5);
    const [alert] = await sql`select alert_type from public.system_alerts where organization_id = ${org} and dedupe_key = ${`STOCK_OVERRIDE:${id}`}`;
    expect(alert?.alert_type).toBe('STOCK_OVERRIDE');
    const [audit] = await sql`select action from public.audit_logs where entity_id = ${id} and action = 'order.confirmed_with_stock_override'`;
    expect(audit).toBeTruthy();
    // Libera para não afetar os outros testes.
    await transitionOrder(admin, id, { to: 'CANCELLED', reason: 'teste concluído', overrideStock: false, windowStart: null, windowEnd: null });
    expect((await stock()).AVAILABLE).toBe(before.AVAILABLE);
  });

  it('reagendar libera, reconfirmar reserva de novo, sair da rota mantém a reserva', async () => {
    const before = await stock();
    const { id } = await createOrderByStaff(manager, order(10, { confirmNow: true }));
    expect((await stock()).RESERVED).toBe(before.RESERVED + 10);
    await transitionOrder(manager, id, { to: 'RESCHEDULED', reason: 'Salão fechado', scheduledDate: addDays(today, 3), overrideStock: false, windowStart: '14:00', windowEnd: '16:00' });
    expect((await stock()).RESERVED).toBe(before.RESERVED);
    const d = await getOrderDetail(manager, id);
    expect(d.order).toMatchObject({ status: 'RESCHEDULED', scheduledDate: addDays(today, 3), windowStart: '14:00' });

    await transitionOrder(manager, id, { to: 'CONFIRMED', overrideStock: false, windowStart: null, windowEnd: null });
    await transitionOrder(manager, id, { to: 'PREPARING', overrideStock: false, windowStart: null, windowEnd: null });
    await transitionOrder(manager, id, { to: 'READY', overrideStock: false, windowStart: null, windowEnd: null });
    expect((await stock()).RESERVED).toBe(before.RESERVED + 10);

    // Atribuição de rota (Fase 5) usa applyTransition; reserva é idempotente (não duplica).
    await withActorTransaction({ type: 'USER', userId: manager.userId, organizationId: org }, (tx) =>
      applyTransition(tx, manager, id, { to: 'ROUTE_ASSIGNED', overrideStock: false, windowStart: null, windowEnd: null }),
    );
    expect((await stock()).RESERVED).toBe(before.RESERVED + 10);
    await withActorTransaction({ type: 'USER', userId: manager.userId, organizationId: org }, (tx) =>
      applyTransition(tx, manager, id, { to: 'READY', overrideStock: false, windowStart: null, windowEnd: null }),
    );
    expect((await stock()).RESERVED).toBe(before.RESERVED + 10);
    await transitionOrder(manager, id, { to: 'CANCELLED', reason: 'teste concluído', overrideStock: false, windowStart: null, windowEnd: null });
    expect((await stock()).RESERVED).toBe(before.RESERVED);
  });

  it('transições fora da tabela e manuais indevidas são rejeitadas; em trânsito não cancela', async () => {
    const { id } = await createOrderByStaff(manager, order(1));
    await expect(transitionOrder(manager, id, { to: 'READY', overrideStock: false, windowStart: null, windowEnd: null })).rejects.toBeInstanceOf(BusinessRuleError);
    await transitionOrder(manager, id, { to: 'CONFIRMED', overrideStock: false, windowStart: null, windowEnd: null });
    await transitionOrder(manager, id, { to: 'PREPARING', overrideStock: false, windowStart: null, windowEnd: null });
    await transitionOrder(manager, id, { to: 'READY', overrideStock: false, windowStart: null, windowEnd: null });
    await expect(transitionOrder(manager, id, { to: 'ROUTE_ASSIGNED', overrideStock: false, windowStart: null, windowEnd: null })).rejects.toThrow(/fluxo de rotas/);
    const ctx = { type: 'USER' as const, userId: manager.userId, organizationId: org };
    await withActorTransaction(ctx, (tx) => applyTransition(tx, manager, id, { to: 'ROUTE_ASSIGNED', overrideStock: false, windowStart: null, windowEnd: null }));
    await withActorTransaction(ctx, (tx) => applyTransition(tx, manager, id, { to: 'IN_TRANSIT', overrideStock: false, windowStart: null, windowEnd: null }));
    await expect(
      withActorTransaction(ctx, (tx) => applyTransition(tx, manager, id, { to: 'CANCELLED', reason: 'x x x', overrideStock: false, windowStart: null, windowEnd: null })),
    ).rejects.toThrow(/problema na entrega/);
  });

  it('valida data no passado, cliente pendente e motorista sem acesso', async () => {
    await expect(createOrderByStaff(manager, order(1, { scheduledDate: addDays(today, -1) }))).rejects.toThrow(/passado/);
    const pending = await withActorTransaction({ type: 'USER', userId: admin.userId, organizationId: org }, (tx) =>
      insertNewCustomer(tx, org, customerCreateSchema.parse({ personType: 'PJ', legalName: 'Pendente Ltda', document: nextCnpj() }), {
        status: 'pending', source: 'SELF_SIGNUP', consentSource: 'SELF_SIGNUP', createdBy: null,
      }),
    );
    await expect(createOrderByStaff(manager, order(1, { customerId: pending }))).rejects.toThrow(/aguardando aprovação/);
    await expect(createOrderByStaff(driver, order(1))).rejects.toBeInstanceOf(AuthorizationError);
    await expect(listOrdersForActor(driver, { page: 1 })).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('numeração sequencial sem repetição sob concorrência', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => createOrderByStaff(manager, order(1))));
    const numbers = results.map((r) => Number(r.number));
    expect(new Set(numbers).size).toBe(5);
    expect(Math.max(...numbers) - Math.min(...numbers)).toBe(4);
  });

  it('duplo clique com a mesma chave cria um pedido só', async () => {
    const key = `order-${randomUUID()}`;
    const [a, b] = await Promise.all([createOrderByStaff(manager, order(2), key), createOrderByStaff(manager, order(2), key)]);
    expect(a.id).toBe(b.id);
  });

  it('itens e histórico não podem ser apagados nem reescritos pelo app', async () => {
    const { id } = await createOrderByStaff(admin, order(1));
    const ctx = { type: 'USER' as const, userId: admin.userId, organizationId: org };
    await expect(withActorTransaction(ctx, (tx) => tx`delete from public.order_items where order_id = ${id}`)).rejects.toThrow(/permission denied/);
    await expect(withActorTransaction(ctx, (tx) => tx`update public.order_items set delivery_quantity = 99 where order_id = ${id}`)).rejects.toThrow(/permission denied/);
    await expect(withActorTransaction(ctx, (tx) => tx`delete from public.orders where id = ${id}`)).rejects.toThrow();
    await expect(sql`update public.order_status_history set reason = 'x' where order_id = ${id}`).rejects.toThrow();
  });
});

describe('portal do cliente', () => {
  it('cliente cria pedido para si, não vê pedidos de outros e só cancela enquanto NEW', async () => {
    const otherCustomer = await newCustomer();
    const { id: othersOrder } = await createOrderByStaff(manager, order(1, { customerId: otherCustomer }));
    const { userId } = await createUserInOrg(org, ['CUSTOMER']);
    await withActorTransaction({ type: 'USER', userId: admin.userId, organizationId: org }, (tx) => linkCustomerUser(tx, org, customer, userId));
    const portal = (await resolveUserActor({ userId, aal: 'aal1' }, org))!;

    const { id } = await createOrderByCustomer(portal, { type: 'DELIVERY', scheduledDate: tomorrow, windowStart: null, windowEnd: null, items: [{ productId: product, deliveryQuantity: 5, collectionQuantity: 0 }], notes: 'Portão azul' }, `p-${randomUUID()}`);
    const mine = await getOrderDetail(portal, id);
    expect(mine.order.customerId).toBe(customer);
    expect(mine.actions).toEqual(['CANCELLED']);
    expect('internalNotes' in mine.order).toBe(false);
    await expect(getOrderDetail(portal, othersOrder)).rejects.toBeInstanceOf(NotFoundError);

    await cancelOwnOrder(portal, id, 'Mudei de ideia');
    const { id: confirmed } = await createOrderByStaff(manager, order(1, { confirmNow: true }));
    await expect(cancelOwnOrder(portal, confirmed, 'x')).rejects.toThrow(/já foi confirmado/);

    // Motivos internos da equipe não aparecem para o cliente; os de cancelamento, sim.
    await transitionOrder(manager, confirmed, { to: 'PREPARING', reason: 'nota interna sigilosa', overrideStock: false, windowStart: null, windowEnd: null });
    const seen = await getOrderDetail(portal, confirmed);
    expect(JSON.stringify(seen)).not.toContain('sigilosa');
    expect(seen.history.every((h) => h.actorName === null)).toBe(true);
    const cancelled = await getOrderDetail(portal, id);
    expect(cancelled.order.statusReason).toContain('Mudei de ideia');
  });
});

describe('integração (n8n)', () => {
  it('cria rascunho pelo telefone de forma idempotente e só enxerga o que criou', async () => {
    const { token } = await createIntegrationToken(org);
    const integ = (await resolveIntegrationActor(token)) as IntegrationActor;
    const key = `wa-msg-${randomUUID()}`;
    const input = { type: 'DELIVERY' as const, scheduledDate: tomorrow, items: [{ productId: product, deliveryQuantity: 20, collectionQuantity: 0 }], customerPhone: '(11) 98765-0000', windowStart: null, windowEnd: null, notes: 'pedido via WhatsApp' };
    const first = await createDraftOrderByIntegration(integ, input, key);
    const again = await createDraftOrderByIntegration(integ, input, key);
    expect(again).toMatchObject({ id: first.id, replayed: true });
    const [o] = await sql`select status, source, customer_id from public.orders where id = ${first.id}`;
    expect(o).toMatchObject({ status: 'DRAFT', source: 'INTEGRATION', customer_id: customer });

    const visible = await withActorTransaction({ type: 'INTEGRATION', tokenId: integ.tokenId, organizationId: org }, (tx) => tx<{ id: string }[]>`select id from public.orders`);
    expect(visible.map((v) => v.id)).toEqual([first.id]);
    await expect(createDraftOrderByIntegration(integ, { ...input, customerPhone: '(11) 90000-0000' }, `k-${randomUUID()}`)).rejects.toBeInstanceOf(NotFoundError);

    // Humano confirma o rascunho.
    await transitionOrder(manager, first.id, { to: 'NEW', overrideStock: false, windowStart: null, windowEnd: null });
  });
});

describe('recorrência', () => {
  it('gera ocorrências dos próximos 7 dias uma única vez (chave regra:data)', async () => {
    const c = await newCustomer();
    await createRecurringRule(manager, {
      customerId: c, type: 'DELIVERY_AND_COLLECTION', weekdays: [1, 3, 5], windowStart: '07:00', windowEnd: '09:00',
      items: [{ productId: product, deliveryQuantity: 15, collectionQuantity: 15 }], notes: null, startsOn: today, endsOn: null,
    });
    const first = await generateRecurringOrders(org);
    const expected = Array.from({ length: 7 }, (_, i) => addDays(today, i)).filter((d) => [1, 3, 5].includes(((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7) + 1)).length;
    const rows = await sql`select occurrence_date from public.orders where customer_id = ${c} and source = 'RECURRENCE'`;
    expect(rows).toHaveLength(expected);
    expect(first.created).toBeGreaterThanOrEqual(expected);

    const [second, third] = await Promise.all([generateRecurringOrders(org), generateRecurringOrders(org)]);
    expect(second.created + third.created).toBe(0);
    expect(await sql`select 1 from public.orders where customer_id = ${c}`).toHaveLength(expected);
  });
});
