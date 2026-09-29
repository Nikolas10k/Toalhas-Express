import { beforeAll, describe, expect, it } from 'vitest';
import type { UserActor } from '@/server/auth/actor';
import { AuthorizationError, BusinessRuleError, InventoryError } from '@/server/core/errors';
import { resolveUserActor } from '@/server/modules/access/access.service';
import { createContract, createContractSchema, simulateContractBilling, transitionContract } from '@/server/modules/contracts/contracts.service';
import { createCustomer, listCustomersForActor } from '@/server/modules/customers/customers.service';
import { getIncidentDetail } from '@/server/modules/incidents/incidents.service';
import { checkInventoryConsistency } from '@/server/modules/inventory/consistency.service';
import { createProduct, getCustomerBalances, getStockOverview, recordMovements, updateProductForActor } from '@/server/modules/inventory/inventory.service';
import { getBatchDetail, registerProduction } from '@/server/modules/laundry/laundry.service';
import { generateLinenDeliveries, getServiceOrderDetail, listServiceOrders, markServiceOrderReady } from '@/server/modules/linen/linen.service';
import { todayInSaoPaulo } from '@/server/modules/orders/orders.domain';
import { createOrderByStaff, getOrderDetail } from '@/server/modules/orders/orders.service';
import { finishRoute, startRoute } from '@/server/modules/routes/driver-app.service';
import { createDriver, createVehicle, driverSchema, vehicleSchema } from '@/server/modules/routes/fleet.service';
import { completeStop, getStopServiceForm } from '@/server/modules/routes/operations.service';
import { createRoute } from '@/server/modules/routes/routes.service';
import { withActorTransaction } from '@/server/db/transaction';
import { customerCreateSchema } from '@/lib/validation/customers';
import { nextCnpj } from '../helpers/documents';
import { createOrg, createUserInOrg, sql } from './fixtures';

let org: string;
let admin: UserActor;
let manager: UserActor;
let operator: UserActor;
let driverUser: UserActor;
let driverId: string;
let towel: string;
let sheet: string;
let pillow: string;
let gym: string;
let hotel: string;
const today = todayInSaoPaulo();
const month = today.slice(0, 7);

async function actor(roles: string[], mfa = false) {
  const { userId } = await createUserInOrg(org, roles);
  return (await resolveUserActor({ userId, aal: mfa ? 'aal2' : 'aal1', lastTotpAt: mfa ? Math.floor(Date.now() / 1000) : undefined }, org))!;
}

async function stock() {
  return (await getStockOverview(admin)).products.find((p) => p.id === towel)!.stock;
}

/** Uma parada executada até o fim: devolve o id da parada e o resultado. */
async function runStop(orderId: string, items: { productId: string; delivered: number; collected: number; damaged?: number }[]) {
  const { id: routeId } = await createRoute(manager, { routeDate: today, driverId, orderIds: [orderId], notes: null });
  await startRoute(driverUser, routeId, null);
  const [stop] = await sql<{ id: string }[]>`select id from public.route_stops where route_id = ${routeId}`;
  const r = await completeStop(driverUser, stop!.id, {
    items: items.map((i) => ({ damaged: 0, ...i })), recipientName: 'Recepção', notes: null, attachmentIds: [], geo: null,
  });
  await finishRoute(driverUser, routeId, null);
  return { stopId: stop!.id, routeId, result: r };
}

async function order(customerId: string, type: 'DELIVERY' | 'COLLECTION', items: { productId: string; deliveryQuantity: number; collectionQuantity: number }[]) {
  return (await createOrderByStaff(manager, {
    customerId, type, scheduledDate: today, windowStart: null, windowEnd: null, items, notes: null, internalNotes: null, confirmNow: true,
  })).id;
}

beforeAll(async () => {
  org = await createOrg('enx');
  admin = await actor(['ADMIN'], true);
  manager = await actor(['MANAGER']);
  operator = await actor(['OPERATOR']);
  driverUser = await actor(['DRIVER']);
  ({ id: towel } = await createProduct(admin, { sku: 'TOA-ENX', name: 'Toalha aluguel', size: null, category: null, costCents: 0, replacementPriceCents: 1500, minStock: 0, active: true, initialQuantity: 1000 }));
  ({ id: sheet } = await createProduct(admin, { sku: 'LEN-CASAL', name: 'Lençol casal (hotel)', size: null, category: null, costCents: 0, replacementPriceCents: 0, minStock: 0, active: true, kind: 'LINEN' }));
  ({ id: pillow } = await createProduct(admin, { sku: 'FRONHA', name: 'Fronha (hotel)', size: null, category: null, costCents: 0, replacementPriceCents: 0, minStock: 0, active: true, kind: 'LINEN' }));
  const { id: van } = await createVehicle(manager, vehicleSchema.parse({ plate: 'ENX1A23', model: 'Van', capacity: 1000 }));
  ({ id: driverId } = await createDriver(manager, driverSchema.parse({ fullName: 'Motorista Enx', userId: driverUser.userId, defaultVehicleId: van })));
  ({ id: gym } = await createCustomer(admin, customerCreateSchema.parse({ personType: 'PJ', legalName: 'Academia Enxuta', document: nextCnpj() })));
  ({ id: hotel } = await createCustomer(admin, customerCreateSchema.parse({ personType: 'PJ', legalName: 'Hotel Central', document: nextCnpj() })));
});

describe('lavanderia enxuta: lançar produção num passo só', () => {
  it('1000 → entrega 100 → coleta 80 → produção (78 boas, 1 dano, 1 descarte): estoque fecha', async () => {
    await runStop(await order(gym, 'DELIVERY', [{ productId: towel, deliveryQuantity: 100, collectionQuantity: 0 }]), [{ productId: towel, delivered: 100, collected: 0 }]);
    await runStop(await order(gym, 'COLLECTION', [{ productId: towel, deliveryQuantity: 0, collectionQuantity: 80 }]), [{ productId: towel, delivered: 0, collected: 80 }]);
    expect((await stock()).byState.AWAITING_LAUNDRY).toBe(80);

    await expect(
      registerProduction(operator, { items: [{ productId: towel, available: 81, damaged: 0, discarded: 0, notes: null }], damageClass: null, notes: null }, 'prod-over-0001'),
    ).rejects.toBeInstanceOf(InventoryError);

    const input = { items: [{ productId: towel, available: 78, damaged: 1, discarded: 1, notes: null }], damageClass: 'TORN' as const, notes: null };
    const p = await registerProduction(operator, input, 'prod-0000000001');
    const again = await registerProduction(operator, input, 'prod-0000000001');
    expect(again.id).toBe(p.id);
    expect(p.incidents).toHaveLength(1);

    const s = await stock();
    expect(s.byState).toMatchObject({ AVAILABLE: 978, AWAITING_LAUNDRY: 0, IN_LAUNDRY: 0, IN_INSPECTION: 0, DAMAGED: 1, DISCARDED: 1 });
    expect((await getCustomerBalances(admin, gym)).find((b) => b.productId === towel)?.quantity).toBe(20);
    expect(s.total).toBe(1000);
    expect(await checkInventoryConsistency(org)).toMatchObject({ divergences: 0 });
    expect((await getBatchDetail(manager, p.id)).batch.status).toBe('COMPLETED');
  });
});

describe('enxoval do cliente (hotel): OS da coleta à entrega, fora do estoque', () => {
  it('coleta com rol → pronta (falta vira ocorrência) → entrega gerada → entregue; cobrança por peça', async () => {
    // Contrato só de higienização: R$ 2,50 por lençol, R$ 1,00 por fronha.
    const { id: contractId } = await createContract(manager, createContractSchema.parse({
      customerId: hotel, billingType: 'PER_QUANTITY', startsOn: `${month}-01`, dueDay: 10,
      items: [{ productId: sheet, unitPriceCents: 250 }, { productId: pillow, unitPriceCents: 100 }],
    }));
    await transitionContract(manager, contractId, { to: 'ACTIVE', reason: null });

    // 1) Coleta: o motorista conta o rol na hora.
    const collect = await order(hotel, 'COLLECTION', [{ productId: sheet, deliveryQuantity: 0, collectionQuantity: 50 }]);
    const c = await runStop(collect, [{ productId: sheet, delivered: 0, collected: 50, damaged: 2 }, { productId: pillow, delivered: 0, collected: 0 }]);
    expect(c.result).toMatchObject({ serviceOrder: expect.stringMatching(/^OS-\d{5}$/) });
    const [m1] = await sql<{ n: number }[]>`select count(*)::int as n from public.towel_movements where product_id in (${sheet}, ${pillow})`;
    expect(m1!.n).toBe(0);
    const [os1] = (await listServiceOrders(operator, { customerId: hotel, page: 1 })).items;
    expect(os1).toMatchObject({ status: 'COLLECTED', pieces: 50 });

    // 2) Saiu da lavanderia com 1 lençol a menos: exige explicação e abre ocorrência (sem mexer em estoque).
    await expect(markServiceOrderReady(operator, os1!.id, { items: [{ productId: sheet, returned: 49 }], divergenceNote: null })).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(markServiceOrderReady(operator, os1!.id, { items: [{ productId: sheet, returned: 51 }], divergenceNote: null })).rejects.toThrow(/só 50 foram coletadas/);
    const ready = await markServiceOrderReady(operator, os1!.id, { items: [{ productId: sheet, returned: 49 }], divergenceNote: 'Lençol rasgou na calandra' });
    expect(ready.incidents).toHaveLength(1);
    const inc = await getIncidentDetail(manager, ready.incidents[0]!);
    expect(inc.actions.decisions).toEqual(['NO_ACTION']);

    // 3) Planejamento: gera o pedido de entrega (operador não pode).
    await expect(generateLinenDeliveries(operator, { scheduledDate: today }, 'gen-op-00000001')).rejects.toBeInstanceOf(AuthorizationError);
    const gen = await generateLinenDeliveries(manager, { scheduledDate: today }, 'gen-00000000001');
    expect(gen.created).toHaveLength(1);
    expect((await generateLinenDeliveries(manager, { scheduledDate: today }, 'gen-00000000002')).created).toHaveLength(0);
    const delivery = await getOrderDetail(manager, gen.created[0]!.orderId);
    expect(delivery.order.status).toBe('CONFIRMED');
    expect(delivery.items).toMatchObject([{ productId: sheet, kind: 'LINEN', deliveryQuantity: 49, reservedQuantity: 0 }]);

    // 4) Entrega do limpo + coleta do sujo na mesma parada.
    const d = await runStop(gen.created[0]!.orderId, [{ productId: sheet, delivered: 49, collected: 30 }, { productId: pillow, delivered: 0, collected: 20 }]);
    const detail = await getServiceOrderDetail(manager, os1!.id);
    expect(detail.serviceOrder.status).toBe('DELIVERED');
    expect(detail.items).toMatchObject([{ productId: sheet, collected: 50, damagedOnArrival: 2, returned: 49, delivered: 49 }]);
    expect(detail.events.map((e) => e.to)).toEqual(['COLLECTED', 'READY', 'READY', 'DELIVERED']);
    expect(d.result).toMatchObject({ serviceOrder: expect.stringMatching(/^OS-/) });
    const [m2] = await sql<{ n: number }[]>`select count(*)::int as n from public.towel_movements where product_id in (${sheet}, ${pillow})`;
    expect(m2!.n).toBe(0);

    // 5) Cobrança por peça higienizada (rol das coletas): 80 lençóis × 2,50 + 20 fronhas × 1,00.
    const sim = await simulateContractBilling(manager, contractId, month);
    expect(sim.billing.lines.map((l) => [l.kind, l.quantity, l.amountCents])).toEqual([['LINEN_SERVICE', 20, 2_000], ['LINEN_SERVICE', 80, 20_000]]);
    expect(sim.billing.totalCents).toBe(22_000);
    expect(sim.usage.deliveries).toBe(0);
  });

  it('parada do hotel já sugere o enxoval de costume; hotel não precisa devolver toalha de aluguel numa entrega de enxoval', async () => {
    await runStop(await order(hotel, 'DELIVERY', [{ productId: towel, deliveryQuantity: 10, collectionQuantity: 0 }]), [{ productId: towel, delivered: 10, collected: 0 }]);
    const [ready] = (await listServiceOrders(manager, { customerId: hotel, status: 'COLLECTED', page: 1 })).items;
    await markServiceOrderReady(manager, ready!.id, { items: ready!.lines.map((l) => ({ productId: l.productId, returned: l.collected })), divergenceNote: null });
    const gen = await generateLinenDeliveries(manager, { scheduledDate: today, serviceOrderIds: [ready!.id] }, 'gen-00000000003');
    const { id: routeId } = await createRoute(manager, { routeDate: today, driverId, orderIds: [gen.created[0]!.orderId], notes: null });
    await startRoute(driverUser, routeId, null);
    const [stop] = await sql<{ id: string }[]>`select id from public.route_stops where route_id = ${routeId}`;
    const form = await getStopServiceForm(driverUser, stop!.id);
    const byId = new Map(form.lines.map((l) => [l.productId, l]));
    expect(byId.get(towel)).toMatchObject({ kind: 'RENTAL', expectedCollection: 0, customerBalance: 10 });
    expect(byId.get(sheet)).toMatchObject({ kind: 'LINEN', plannedDelivery: 30, loaded: 30 });
    expect(byId.get(pillow)).toMatchObject({ kind: 'LINEN', plannedDelivery: 20 });
    const r = await completeStop(driverUser, stop!.id, {
      items: [{ productId: sheet, delivered: 30, collected: 0, damaged: 0 }, { productId: pillow, delivered: 18, collected: 0, damaged: 0 }],
      recipientName: 'Governança', notes: null, attachmentIds: [], geo: null,
    });
    // Só a fronha entregue a menos vira ocorrência; nenhuma divergência de toalha de aluguel.
    expect(r.incidents).toHaveLength(1);
  });
});

describe('regras e permissões', () => {
  it('enxoval não tem estoque; produto com histórico não muda de tipo; banco recusa movimento de enxoval', async () => {
    await expect(createProduct(admin, { sku: 'LEN-X', name: 'Lençol X', size: null, category: null, costCents: 0, replacementPriceCents: 0, minStock: 0, active: true, kind: 'LINEN', initialQuantity: 10 }))
      .rejects.toThrow(/não tem estoque/);
    await expect(updateProductForActor(admin, towel, { kind: 'LINEN' })).rejects.toThrow(/mudar de tipo/);
    await expect(
      withActorTransaction({ type: 'USER', userId: admin.userId, organizationId: org }, (tx) =>
        recordMovements(tx, admin, [{ productId: sheet, type: 'STOCK_ENTRY', quantity: 1, from: 'EXTERNAL', to: 'AVAILABLE' }])),
    ).rejects.toThrow(/Enxoval de cliente/);
  });

  it('operador vê lavanderia e OS, mas não clientes nem estoque de aluguel', async () => {
    await expect(listCustomersForActor(operator, { page: 1 } as never)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(getStockOverview(operator)).rejects.toBeInstanceOf(AuthorizationError);
    expect((await listServiceOrders(operator, { page: 1 })).items.length).toBeGreaterThan(0);
  });
});
