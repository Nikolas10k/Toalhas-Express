import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { UserActor } from '@/server/auth/actor';
import { AuthorizationError, BusinessRuleError, ConflictError, NotFoundError, ProviderError, ValidationError } from '@/server/core/errors';
import { withActorTransaction } from '@/server/db/transaction';
import { resolveUserActor } from '@/server/modules/access/access.service';
import { createCustomer } from '@/server/modules/customers/customers.service';
import { setMapsProviderForTesting } from '@/server/modules/customers/geocoding.service';
import { createProduct, executeStockOperation, getStockOverview } from '@/server/modules/inventory/inventory.service';
import { addDays, todayInSaoPaulo } from '@/server/modules/orders/orders.domain';
import { createOrderByStaff, getOrderDetail, transitionOrder } from '@/server/modules/orders/orders.service';
import { driverStopAction, finishRoute, getDriverHome, getDriverRoute, startRoute } from '@/server/modules/routes/driver-app.service';
import { createDriver, createVehicle, driverSchema, listDriverUserCandidates, updateDriver, vehicleSchema } from '@/server/modules/routes/fleet.service';
import {
  addStops,
  cancelRoute,
  createRoute,
  getRouteDetail,
  listPlannableOrders,
  optimizeRoute,
  removeStop,
  reorderStops,
  updateDepot,
} from '@/server/modules/routes/routes.service';
import type { MapsProvider } from '@/server/providers/maps-provider';
import { customerCreateSchema } from '@/lib/validation/customers';
import { nextCnpj } from '../helpers/documents';
import { createOrg, createUserInOrg, sql } from './fixtures';

let org: string;
let admin: UserActor;
let manager: UserActor;
let driverUserA: UserActor;
let driverUserB: UserActor;
let driverA: string;
let driverB: string;
let van: string;
let bike: string;
let product: string;
let customer: string;
const today = todayInSaoPaulo();

async function actor(roles: string[], mfa = false) {
  const { userId } = await createUserInOrg(org, roles);
  return (await resolveUserActor({ userId, aal: mfa ? 'aal2' : 'aal1', lastTotpAt: mfa ? Math.floor(Date.now() / 1000) : undefined }, org))!;
}

async function stock() {
  const o = await getStockOverview(admin);
  return o.products.find((p) => p.id === product)!.stock.byState;
}

/** Pedido READY para hoje com N toalhas a entregar (reservadas ao confirmar). */
async function readyOrder(qty: number, date = today, customerId = customer) {
  const { id } = await createOrderByStaff(manager, {
    customerId,
    type: 'DELIVERY_AND_COLLECTION',
    scheduledDate: date,
    windowStart: null,
    windowEnd: null,
    items: [{ productId: product, deliveryQuantity: qty, collectionQuantity: 2 }],
    notes: 'Entrar pela lateral',
    internalNotes: 'nota interna da equipe',
    confirmNow: true,
  });
  const t = { overrideStock: false, windowStart: null, windowEnd: null } as const;
  await transitionOrder(manager, id, { ...t, to: 'PREPARING' });
  await transitionOrder(manager, id, { ...t, to: 'READY' });
  return id;
}

async function newCustomer(lat: number, lng: number) {
  const { id } = await createCustomer(admin, customerCreateSchema.parse({ personType: 'PJ', legalName: 'Salão Rota', document: nextCnpj(), whatsapp: '+5511912345678' }));
  await sql`update public.customers set latitude = ${lat}, longitude = ${lng}, geocode_status = 'MANUAL' where id = ${id}`;
  return id;
}

async function asUser<T>(a: UserActor, q: (tx: Parameters<Parameters<typeof withActorTransaction>[1]>[0]) => Promise<T>) {
  return withActorTransaction({ type: 'USER', userId: a.userId, organizationId: org }, q);
}

beforeAll(async () => {
  org = await createOrg('rota');
  admin = await actor(['ADMIN'], true);
  manager = await actor(['MANAGER']);
  driverUserA = await actor(['DRIVER']);
  driverUserB = await actor(['DRIVER']);
  ({ id: product } = await createProduct(admin, { sku: 'TOA-ROTA', name: 'Toalha rota', size: null, category: null, costCents: 0, replacementPriceCents: 1500, minStock: 0, active: true }));
  await executeStockOperation(admin, { kind: 'entry', productId: product, quantity: 500, reason: 'Estoque inicial' });
  customer = await newCustomer(-23.55, -46.63);
  ({ id: van } = await createVehicle(manager, vehicleSchema.parse({ plate: 'abc-1d23', model: 'Fiorino', capacity: 200, status: 'ACTIVE', notes: null })));
  ({ id: bike } = await createVehicle(manager, vehicleSchema.parse({ plate: 'XYZ1234', model: 'Moto', capacity: 20, status: 'ACTIVE', notes: null })));
  ({ id: driverA } = await createDriver(manager, driverSchema.parse({ fullName: 'João Motorista', document: '529.982.247-25', phone: '(11) 98888-7777', userId: driverUserA.userId, defaultVehicleId: van, status: 'ACTIVE', notes: null })));
  ({ id: driverB } = await createDriver(manager, driverSchema.parse({ fullName: 'Maria Motorista', document: null, phone: null, userId: driverUserB.userId, defaultVehicleId: bike, status: 'ACTIVE', notes: null })));
});

afterEach(() => setMapsProviderForTesting(undefined));

describe('frota', () => {
  it('normaliza placa, bloqueia placa repetida, CPF inválido e usuário sem perfil de motorista', async () => {
    const [v] = await sql`select plate from public.vehicles where id = ${van}`;
    expect(v?.plate).toBe('ABC1D23');
    await expect(createVehicle(manager, vehicleSchema.parse({ plate: 'ABC1D23', model: 'Outro', capacity: 10, status: 'ACTIVE', notes: null }))).rejects.toBeInstanceOf(ConflictError);
    await expect(createVehicle(manager, vehicleSchema.parse({ plate: '12345678', model: 'Outro', capacity: 10, status: 'ACTIVE', notes: null }))).rejects.toBeInstanceOf(ValidationError);
    await expect(createDriver(manager, driverSchema.parse({ fullName: 'CPF ruim', document: '111.111.111-11', status: 'ACTIVE' }))).rejects.toBeInstanceOf(ValidationError);
    await expect(createDriver(manager, driverSchema.parse({ fullName: 'Não motorista', userId: manager.userId, status: 'ACTIVE' }))).rejects.toThrow(/perfil Motorista/);
    await expect(createDriver(manager, driverSchema.parse({ fullName: 'Duplicado', userId: driverUserA.userId, status: 'ACTIVE' }))).rejects.toBeInstanceOf(ConflictError);
    await expect(createDriver(driverUserA, driverSchema.parse({ fullName: 'Eu mesmo', status: 'ACTIVE' }))).rejects.toBeInstanceOf(AuthorizationError);
    const candidates = await listDriverUserCandidates(admin);
    expect(candidates.map((c) => c.userId)).not.toContain(driverUserA.userId);
  });
});

describe('planejamento de rotas', () => {
  it('cria rota com pedidos prontos: ROUTE_ASSIGNED, paradas em ordem, reserva mantida e idempotente', async () => {
    const before = await stock();
    const o1 = await readyOrder(10);
    const o2 = await readyOrder(5);
    expect((await stock()).RESERVED).toBe(before.RESERVED + 15);
    const plannable = await listPlannableOrders(manager, today);
    expect(plannable.map((p) => p.id)).toEqual(expect.arrayContaining([o1, o2]));

    const key = `route-${randomUUID()}`;
    const input = { routeDate: today, driverId: driverA, orderIds: [o2, o1], notes: null };
    const [a, b] = await Promise.all([createRoute(manager, input, key), createRoute(manager, input, key)]);
    expect(a.id).toBe(b.id);
    const d = await getRouteDetail(manager, a.id);
    expect(d.route).toMatchObject({ status: 'PLANNED', vehicleId: van, driverId: driverA });
    expect(d.stops.map((s) => [s.orderId, s.sequence])).toEqual([[o2, 1], [o1, 2]]);
    expect(d.totalDelivery).toBe(15);
    expect((await getOrderDetail(manager, o1)).order.status).toBe('ROUTE_ASSIGNED');
    expect((await stock()).RESERVED).toBe(before.RESERVED + 15);

    // Mesmo motorista, mesma data: não abre segunda rota.
    const o3 = await readyOrder(1);
    await expect(createRoute(manager, { routeDate: today, driverId: driverA, orderIds: [o3], notes: null })).rejects.toThrow(/já tem uma rota aberta/);
    // Pedido já em rota não entra em outra.
    await expect(createRoute(manager, { routeDate: today, driverId: driverB, orderIds: [o1], notes: null })).rejects.toThrow(/já está em outra rota/);

    // Reordenar exige permutação exata.
    await expect(reorderStops(manager, a.id, [d.stops[0]!.id])).rejects.toBeInstanceOf(BusinessRuleError);
    await reorderStops(manager, a.id, [d.stops[1]!.id, d.stops[0]!.id]);
    expect((await getRouteDetail(manager, a.id)).stops.map((s) => s.orderId)).toEqual([o1, o2]);

    // Adicionar e remover parada: remover devolve READY com a reserva.
    await addStops(manager, a.id, [o3]);
    const withO3 = await getRouteDetail(manager, a.id);
    const stopO3 = withO3.stops.find((s) => s.orderId === o3)!;
    expect(stopO3.sequence).toBe(3);
    await removeStop(manager, a.id, withO3.stops[0]!.id);
    const after = await getRouteDetail(manager, a.id);
    expect(after.stops.map((s) => s.sequence)).toEqual([1, 2]);
    expect((await getOrderDetail(manager, o1)).order.status).toBe('READY');
    expect((await stock()).RESERVED).toBe(before.RESERVED + 16);

    // Cancelar a rota: pedidos voltam a READY, paradas ficam registradas como SKIPPED.
    await cancelRoute(manager, a.id, 'Motorista doente');
    const cancelled = await getRouteDetail(manager, a.id);
    expect(cancelled.route.status).toBe('CANCELLED');
    expect(cancelled.stops.every((s) => s.status === 'SKIPPED')).toBe(true);
    expect((await getOrderDetail(manager, o2)).order.status).toBe('READY');
    expect((await stock()).RESERVED).toBe(before.RESERVED + 16);
    const [ev] = await sql`select count(*)::int as n from public.outbox_events where aggregate_id = ${a.id} and event_type = 'RouteCancelled'`;
    expect(ev?.n).toBe(1);
    // Limpeza: devolve ao estoque.
    for (const id of [o1, o2, o3]) await transitionOrder(manager, id, { to: 'CANCELLED', reason: 'fim do teste', overrideStock: false, windowStart: null, windowEnd: null });
  });

  it('rejeita pedido não pronto, de outra data, capacidade excedida e data passada', async () => {
    const { id: notReady } = await createOrderByStaff(manager, {
      customerId: customer, type: 'DELIVERY', scheduledDate: today, windowStart: null, windowEnd: null,
      items: [{ productId: product, deliveryQuantity: 1, collectionQuantity: 0 }], notes: null, internalNotes: null, confirmNow: true,
    });
    await expect(createRoute(manager, { routeDate: today, driverId: driverB, orderIds: [notReady], notes: null })).rejects.toThrow(/não está pronto/);
    const other = await readyOrder(1, addDays(today, 1));
    await expect(createRoute(manager, { routeDate: today, driverId: driverB, orderIds: [other], notes: null })).rejects.toThrow(/outra data/);
    const big = await readyOrder(30);
    await expect(createRoute(manager, { routeDate: today, driverId: driverB, orderIds: [big], notes: null })).rejects.toThrow(/comporta 20/);
    await expect(createRoute(manager, { routeDate: addDays(today, -1), driverId: driverB, orderIds: [big], notes: null })).rejects.toThrow(/passado/);
    // Nada ficou pela metade.
    expect((await getOrderDetail(manager, big)).order.status).toBe('READY');
    await expect(createRoute(driverUserA, { routeDate: today, driverId: driverA, orderIds: [big], notes: null })).rejects.toBeInstanceOf(AuthorizationError);
    for (const id of [notReady, other, big]) await transitionOrder(manager, id, { to: 'CANCELLED', reason: 'fim do teste', overrideStock: false, windowStart: null, windowEnd: null });
  });

  it('duas rotas disputando o mesmo pedido ao mesmo tempo: só uma leva', async () => {
    const o = await readyOrder(1);
    const results = await Promise.allSettled([
      createRoute(manager, { routeDate: today, driverId: driverA, orderIds: [o], notes: null }),
      createRoute(manager, { routeDate: today, driverId: driverB, orderIds: [o], notes: null }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ id: string }>[];
    expect(ok).toHaveLength(1);
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(failed.reason).toBeInstanceOf(BusinessRuleError);
    const [n] = await sql`select count(*)::int as n from public.route_stops where order_id = ${o}`;
    expect(n?.n).toBe(1);
    await cancelRoute(manager, ok[0]!.value.id, 'fim do teste');
    await transitionOrder(manager, o, { to: 'CANCELLED', reason: 'fim do teste', overrideStock: false, windowStart: null, windowEnd: null });
  });

  it('otimização: exige base; aplica a ordem do provedor; falha externa não muda nada', async () => {
    const c2 = await newCustomer(-23.6, -46.7);
    const o1 = await readyOrder(1);
    const o2 = await readyOrder(1, today, c2);
    const { id } = await createRoute(manager, { routeDate: today, driverId: driverB, orderIds: [o1, o2], notes: null });

    setMapsProviderForTesting(null);
    await expect(optimizeRoute(manager, id)).rejects.toThrow(/chave do Google Maps/);

    const fake: MapsProvider = {
      name: 'fake',
      geocode: async () => null,
      optimizeRoute: async (_o, stops) => ({ orderedStopIds: stops.map((s) => s.id).reverse(), distanceMeters: 12345, durationSeconds: 1800 }),
    };
    setMapsProviderForTesting(fake);
    await expect(optimizeRoute(manager, id)).rejects.toThrow(/base de saída/);
    await expect(updateDepot(driverUserA, { name: 'Base', latitude: -23.5, longitude: -46.6 })).rejects.toBeInstanceOf(AuthorizationError);
    await updateDepot(manager, { name: 'Lavanderia central', latitude: -23.5, longitude: -46.6 });

    const r = await optimizeRoute(manager, id);
    expect(r).toMatchObject({ ordering: 'OPTIMIZED', distanceMeters: 12345 });
    const d = await getRouteDetail(manager, id);
    expect(d.stops.map((s) => s.orderId)).toEqual([o2, o1]);
    expect(d.depot?.name).toBe('Lavanderia central');

    setMapsProviderForTesting({ ...fake, optimizeRoute: async () => { throw new ProviderError('fake', 'caiu'); } });
    await expect(optimizeRoute(manager, id)).rejects.toThrow(/Não foi possível otimizar/);
    expect((await getRouteDetail(manager, id)).stops.map((s) => s.orderId)).toEqual([o2, o1]);

    // Provedor que devolve paradas erradas nunca é aplicado.
    setMapsProviderForTesting({ ...fake, optimizeRoute: async () => ({ orderedStopIds: [randomUUID(), randomUUID()], distanceMeters: 1, durationSeconds: 1 }) });
    await expect(optimizeRoute(manager, id)).rejects.toThrow(/paradas mudaram/);
    await cancelRoute(manager, id, 'fim do teste');
    for (const o of [o1, o2]) await transitionOrder(manager, o, { to: 'CANCELLED', reason: 'fim do teste', overrideStock: false, windowStart: null, windowEnd: null });
  });
});

describe('app do motorista', () => {
  it('motorista só vê a própria rota; sem acesso a planejamento nem a pedidos de outros', async () => {
    const o1 = await readyOrder(3);
    const { id } = await createRoute(manager, { routeDate: today, driverId: driverA, orderIds: [o1], notes: null });

    const home = await getDriverHome(driverUserA);
    expect(home.routes.map((r) => r.id)).toContain(id);
    expect((await getDriverHome(driverUserB)).routes.map((r) => r.id)).not.toContain(id);
    await expect(getDriverRoute(driverUserB, id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getRouteDetail(driverUserA, id)).rejects.toBeInstanceOf(AuthorizationError);

    const mine = await getDriverRoute(driverUserA, id);
    expect(mine.stops[0]).toMatchObject({ customerName: 'Salão Rota', phone: '+5511912345678', notes: 'Entrar pela lateral' });
    expect(JSON.stringify(mine)).not.toContain('nota interna');
    expect(JSON.stringify(mine)).not.toMatch(/Cents|price|replacement/i);

    // RLS direto: B não enxerga pedido, cliente nem movimentos da rota de A.
    const seenByB = await asUser(driverUserB, (tx) => tx`select id from public.orders where id = ${o1}`);
    const custByB = await asUser(driverUserB, (tx) => tx`select id from public.customers where id = ${customer}`);
    const movByB = await asUser(driverUserB, (tx) => tx`select id from public.towel_movements where order_id = ${o1}`);
    expect([seenByB.length, custByB.length, movByB.length]).toEqual([0, 0, 0]);
    const seenByA = await asUser(driverUserA, (tx) => tx`select id from public.orders where id = ${o1}`);
    expect(seenByA.length).toBe(1);
    // Motorista não altera rota de outro nem lista rotas pela via administrativa.
    const upd = await asUser(driverUserB, (tx) => tx`update public.routes set notes = 'x' where id = ${id}`);
    expect(upd.count).toBe(0);
    await cancelRoute(manager, id, 'fim do teste');
    await transitionOrder(manager, o1, { to: 'CANCELLED', reason: 'fim do teste', overrideStock: false, windowStart: null, windowEnd: null });
  });

  it('iniciar rota carrega o veículo (RESERVED → IN_ROUTE), pedidos em trânsito, sem duplicar', async () => {
    const before = await stock();
    const o1 = await readyOrder(4);
    const o2 = await readyOrder(6);
    const { id } = await createRoute(manager, { routeDate: today, driverId: driverA, orderIds: [o1, o2], notes: null });
    await expect(startRoute(driverUserB, id, null)).rejects.toBeInstanceOf(NotFoundError);

    const [s1, s2] = await Promise.all([startRoute(driverUserA, id, { latitude: -23.5, longitude: -46.6, accuracy: 10 }), startRoute(driverUserA, id, null)]);
    expect([s1.replayed, s2.replayed].sort()).toEqual([false, true]);
    const now = await stock();
    expect(now.RESERVED).toBe(before.RESERVED);
    expect(now.IN_ROUTE).toBe(before.IN_ROUTE + 10);
    expect((await getOrderDetail(manager, o1)).order.status).toBe('IN_TRANSIT');
    const [mv] = await sql`select count(*)::int as n from public.towel_movements where route_id = ${id} and movement_type = 'DELIVERY_DISPATCH'`;
    expect(mv?.n).toBe(2);

    const r = await getDriverRoute(driverUserA, id);
    expect(r.route.status).toBe('IN_PROGRESS');
    expect(r.stops.map((s) => s.status)).toEqual(['ON_THE_WAY', 'PENDING']);
    expect(r.canFinish).toBe(false);
    const [first, second] = r.stops;

    // Trocar a próxima parada devolve a anterior para PENDING.
    await driverStopAction(driverUserA, second!.id, { action: 'ON_THE_WAY', geo: null });
    await driverStopAction(driverUserA, first!.id, { action: 'ON_THE_WAY', geo: null });
    await driverStopAction(driverUserA, first!.id, { action: 'ARRIVED', geo: { latitude: -23.55, longitude: -46.63, accuracy: 5 } });
    const again = await driverStopAction(driverUserA, first!.id, { action: 'ARRIVED', geo: null });
    expect(again.replayed).toBe(true);
    // Na parada: não pode seguir para outra antes de concluir; nem voltar.
    await expect(driverStopAction(driverUserA, second!.id, { action: 'ON_THE_WAY', geo: null })).rejects.toThrow(/Conclua a parada/);
    await expect(driverStopAction(driverUserA, first!.id, { action: 'ON_THE_WAY', geo: null })).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(driverStopAction(driverUserB, first!.id, { action: 'ARRIVED', geo: null })).rejects.toBeInstanceOf(NotFoundError);

    await expect(finishRoute(driverUserA, id, null)).rejects.toThrow(/parada\(s\) em aberto/);
    await expect(cancelRoute(manager, id, 'tentativa')).rejects.toThrow(/em andamento/);
    await expect(removeStop(manager, id, second!.id)).rejects.toThrow(/planejadas/);

    const [geo] = await sql`select latitude::float8 as lat, metadata from public.route_events where route_stop_id = ${first!.id} and to_status = 'ARRIVED'`;
    expect(geo?.lat).toBeCloseTo(-23.55);
    const [noGeo] = await sql`select metadata from public.route_events where route_stop_id = ${second!.id} and to_status = 'ON_THE_WAY'`;
    expect(noGeo?.metadata).toMatchObject({ geolocation: 'unavailable' });
  });

  it('rota de outro dia não inicia; motorista inativo perde o acesso', async () => {
    const o1 = await readyOrder(1, addDays(today, 2));
    const { id } = await createRoute(manager, { routeDate: addDays(today, 2), driverId: driverB, orderIds: [o1], notes: null });
    await expect(startRoute(driverUserB, id, null)).rejects.toThrow(/outro dia/);
    await expect(updateDriver(manager, driverB, { status: 'INACTIVE' })).rejects.toThrow(/rota aberta/);
    await cancelRoute(manager, id, 'fim do teste');
    await updateDriver(manager, driverB, { status: 'INACTIVE' });
    await expect(getDriverHome(driverUserB)).rejects.toBeInstanceOf(AuthorizationError);
    await updateDriver(manager, driverB, { status: 'ACTIVE' });
    await transitionOrder(manager, o1, { to: 'CANCELLED', reason: 'fim do teste', overrideStock: false, windowStart: null, windowEnd: null });
  });
});
