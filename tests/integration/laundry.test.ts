import { beforeAll, describe, expect, it } from 'vitest';
import type { UserActor } from '@/server/auth/actor';
import { AuthorizationError, BusinessRuleError, InventoryError, ValidationError } from '@/server/core/errors';
import { resolveUserActor } from '@/server/modules/access/access.service';
import { createCustomer } from '@/server/modules/customers/customers.service';
import { getIncidentDetail, resolveIncident } from '@/server/modules/incidents/incidents.service';
import { checkInventoryConsistency } from '@/server/modules/inventory/consistency.service';
import { createProduct, executeStockOperation, getCustomerBalances, getStockOverview } from '@/server/modules/inventory/inventory.service';
import { advanceBatch, completeInspection, createBatch, getBatchDetail, getLaundryOverview, receiveRoute } from '@/server/modules/laundry/laundry.service';
import { todayInSaoPaulo } from '@/server/modules/orders/orders.domain';
import { createOrderByStaff } from '@/server/modules/orders/orders.service';
import { finishRoute, startRoute } from '@/server/modules/routes/driver-app.service';
import { createDriver, createVehicle, driverSchema, vehicleSchema } from '@/server/modules/routes/fleet.service';
import { completeStop } from '@/server/modules/routes/operations.service';
import { createRoute } from '@/server/modules/routes/routes.service';
import { customerCreateSchema } from '@/lib/validation/customers';
import { nextCnpj } from '../helpers/documents';
import { createOrg, createUserInOrg, sql } from './fixtures';

let org: string;
let admin: UserActor;
let manager: UserActor;
let driverUser: UserActor;
let driverId: string;
let product: string;
let customer: string;
const today = todayInSaoPaulo();

async function actor(roles: string[], mfa = false) {
  const { userId } = await createUserInOrg(org, roles);
  return (await resolveUserActor({ userId, aal: mfa ? 'aal2' : 'aal1', lastTotpAt: mfa ? Math.floor(Date.now() / 1000) : undefined }, org))!;
}

async function stock() {
  return (await getStockOverview(admin)).products.find((p) => p.id === product)!.stock;
}

async function customerHas() {
  return (await getCustomerBalances(admin, customer)).find((b) => b.productId === product)?.quantity ?? 0;
}

/** Rota de um pedido só, executada até o fim. Devolve o id da rota. */
async function runStop(type: 'DELIVERY' | 'COLLECTION', deliver: number, collect: number, delivered: number, collected: number) {
  const { id: orderId } = await createOrderByStaff(manager, {
    customerId: customer, type, scheduledDate: today, windowStart: null, windowEnd: null,
    items: [{ productId: product, deliveryQuantity: deliver, collectionQuantity: collect }], notes: null, internalNotes: null, confirmNow: true,
  });
  const { id: routeId } = await createRoute(manager, { routeDate: today, driverId, orderIds: [orderId], notes: null });
  await startRoute(driverUser, routeId, null);
  const [stop] = await sql<{ id: string }[]>`select id from public.route_stops where route_id = ${routeId}`;
  await completeStop(driverUser, stop!.id, { items: [{ productId: product, delivered, collected, damaged: 0 }], recipientName: 'Recepção', notes: null, attachmentIds: [], geo: null });
  await finishRoute(driverUser, routeId, null);
  return routeId;
}

beforeAll(async () => {
  org = await createOrg('lav');
  admin = await actor(['ADMIN'], true);
  manager = await actor(['MANAGER']);
  driverUser = await actor(['DRIVER']);
  ({ id: product } = await createProduct(admin, { sku: 'TOA-LAV', name: 'Toalha lavanderia', size: null, category: null, costCents: 0, replacementPriceCents: 1500, minStock: 0, active: true, initialQuantity: 1000 }));
  const { id: van } = await createVehicle(manager, vehicleSchema.parse({ plate: 'LAV1A23', model: 'Van', capacity: 1000 }));
  ({ id: driverId } = await createDriver(manager, driverSchema.parse({ fullName: 'Motorista Lav', userId: driverUser.userId, defaultVehicleId: van })));
  ({ id: customer } = await createCustomer(admin, customerCreateSchema.parse({ personType: 'PJ', legalName: 'Academia Lavanderia', document: nextCnpj() })));
});

describe('SPEC §14 — ciclo completo: nenhuma toalha some', () => {
  it('1000 → entrega 100 → coleta 80 → lavagem: 980 disponíveis e 20 com o cliente', async () => {
    await runStop('DELIVERY', 100, 0, 100, 0);
    expect((await stock()).byState.AVAILABLE).toBe(900);
    const collectRoute = await runStop('COLLECTION', 0, 80, 0, 80);
    let s = await stock();
    expect(await customerHas()).toBe(20);
    expect(s.byState.AWAITING_LAUNDRY).toBe(80);

    // Conferência na base: chegaram as 80.
    const overview = await getLaundryOverview(manager);
    expect(overview.pendingReceipts.map((r) => r.routeId)).toContain(collectRoute);
    const rec = await receiveRoute(manager, collectRoute, { items: [{ productId: product, counted: 80 }], notes: null });
    expect(rec.incidents).toHaveLength(0);
    expect((await getLaundryOverview(manager)).pendingReceipts.map((r) => r.routeId)).not.toContain(collectRoute);

    const { id } = await createBatch(manager, { items: [{ productId: product, quantity: 80 }], provider: 'Lavanderia própria', notes: null });
    expect((await stock()).byState.IN_LAUNDRY).toBe(80);
    for (const to of ['WASHING', 'DRYING', 'FOLDING', 'INSPECTION'] as const) await advanceBatch(manager, id, { to, note: null });
    expect((await stock()).byState.IN_INSPECTION).toBe(80);
    await completeInspection(manager, id, { items: [{ productId: product, available: 80, damaged: 0, discarded: 0, notes: null }], damageClass: null });

    s = await stock();
    expect(s.byState.AVAILABLE).toBe(980);
    expect(await customerHas()).toBe(20);
    expect(s.total).toBe(1000);
    const check = await checkInventoryConsistency(org);
    expect(check).toMatchObject({ divergences: 0 });
    const detail = await getBatchDetail(manager, id);
    expect(detail.batch.status).toBe('COMPLETED');
    expect(detail.events.map((e) => e.to)).toEqual(['WAITING', 'WASHING', 'DRYING', 'FOLDING', 'INSPECTION', 'COMPLETED']);
  });
});

describe('lotes e inspeção', () => {
  it('lote não passa da fila; duas montagens simultâneas não tiram a mesma toalha; etapas fora de ordem são recusadas', async () => {
    await executeStockOperation(admin, { kind: 'move', type: 'TRANSFER', productId: product, from: 'AVAILABLE', to: 'AWAITING_LAUNDRY', quantity: 30, customerId: null, reason: 'Toalhas usadas na base' });
    const queue = (await getLaundryOverview(manager)).queue.find((q) => q.productId === product)!.awaiting;
    await expect(createBatch(manager, { items: [{ productId: product, quantity: queue + 1 }], provider: null, notes: null })).rejects.toBeInstanceOf(InventoryError);
    const results = await Promise.allSettled([
      createBatch(manager, { items: [{ productId: product, quantity: queue }], provider: null, notes: null }),
      createBatch(manager, { items: [{ productId: product, quantity: queue }], provider: null, notes: null }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const ok = (results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ id: string }>).value;
    await expect(advanceBatch(manager, ok.id, { to: 'FOLDING', note: null })).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(advanceBatch(manager, ok.id, { to: 'CANCELLED', note: null })).rejects.toBeInstanceOf(ValidationError);

    // Cancelar antes de lavar devolve as toalhas para a fila.
    const before = await stock();
    await advanceBatch(manager, ok.id, { to: 'CANCELLED', note: 'Máquina quebrada' });
    const after = await stock();
    expect(after.byState.AWAITING_LAUNDRY).toBe(before.byState.AWAITING_LAUNDRY + queue);
    expect(after.byState.IN_LAUNDRY).toBe(before.byState.IN_LAUNDRY - queue);
    await expect(advanceBatch(manager, ok.id, { to: 'WASHING', note: null })).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(createBatch(driverUser, { items: [{ productId: product, quantity: 1 }], provider: null, notes: null })).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('inspeção precisa fechar; dano vira ocorrência sem cliente e pode voltar ao estoque; descarte sai do total', async () => {
    const { id } = await createBatch(manager, { items: [{ productId: product, quantity: 10 }], provider: null, notes: null });
    for (const to of ['WASHING', 'DRYING', 'FOLDING', 'INSPECTION'] as const) await advanceBatch(manager, id, { to, note: null });
    await expect(completeInspection(manager, id, { items: [{ productId: product, available: 6, damaged: 2, discarded: 1, notes: null }], damageClass: 'STAINED' })).rejects.toThrow(/somou 9/);
    await expect(completeInspection(manager, id, { items: [{ productId: product, available: 7, damaged: 2, discarded: 1, notes: null }], damageClass: null })).rejects.toThrow(/tipo de dano/);
    const before = await stock();
    const res = await completeInspection(manager, id, { items: [{ productId: product, available: 7, damaged: 2, discarded: 1, notes: null }], damageClass: 'STAINED' });
    const after = await stock();
    expect(after.byState.AVAILABLE).toBe(before.byState.AVAILABLE + 7);
    expect(after.byState.DAMAGED).toBe(before.byState.DAMAGED + 2);
    expect(after.byState.DISCARDED).toBe(before.byState.DISCARDED + 1);

    const inc = await getIncidentDetail(manager, res.incidents[0]!);
    expect(inc.incident).toMatchObject({ type: 'DAMAGED', quantity: 2, damageClass: 'STAINED', customerId: null });
    expect(inc.actions.decisions).toEqual(['RETURN_TO_LAUNDRY', 'RETURN_TO_STOCK', 'DISCARD']);
    await resolveIncident(manager, inc.incident.id, { decision: 'RETURN_TO_STOCK', resolution: 'Mancha saiu na segunda lavagem', chargeCustomer: false });
    expect((await stock()).byState.DAMAGED).toBe(before.byState.DAMAGED);
    expect(await checkInventoryConsistency(org)).toMatchObject({ divergences: 0 });
  });
});

describe('conferência com divergência', () => {
  it('faltou toalha na base: ocorrência e perda interna, nunca cobrada do cliente; conferir duas vezes não duplica', async () => {
    await executeStockOperation(admin, { kind: 'adjust', productId: product, state: 'WITH_CUSTOMER', delta: 10, customerId: customer, reason: 'Ajuste de saldo para teste' });
    const routeId = await runStop('COLLECTION', 0, 10, 0, 10);
    const [a, b] = await Promise.all([
      receiveRoute(manager, routeId, { items: [{ productId: product, counted: 8 }], notes: 'Duas faltando no saco' }),
      receiveRoute(manager, routeId, { items: [{ productId: product, counted: 8 }], notes: 'Duas faltando no saco' }),
    ]);
    expect(a.receiptId).toBe(b.receiptId);
    const incidentId = (a.incidents[0] ?? b.incidents[0])!;
    const inc = await getIncidentDetail(manager, incidentId);
    expect(inc.incident).toMatchObject({ type: 'QUANTITY_DIVERGENCE', quantity: 2 });
    expect(inc.actions.decisions).toEqual(['NO_ACTION', 'REGISTER_LOSS']);
    await expect(resolveIncident(manager, incidentId, { decision: 'REGISTER_LOSS', resolution: 'Perdidas no transporte', chargeCustomer: true })).rejects.toThrow(/perda interna/);
    const before = await stock();
    await resolveIncident(manager, incidentId, { decision: 'REGISTER_LOSS', resolution: 'Perdidas no transporte', chargeCustomer: false });
    const after = await stock();
    expect(after.byState.LOST).toBe(before.byState.LOST + 2);
    expect(after.byState.AWAITING_LAUNDRY).toBe(before.byState.AWAITING_LAUNDRY - 2);
    const bills = await sql`select 1 from public.billable_events where source_id = ${incidentId}`;
    expect(bills).toHaveLength(0);
  });
});
