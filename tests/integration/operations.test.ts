import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { UserActor } from '@/server/auth/actor';
import { AuthorizationError, BusinessRuleError, NotFoundError, ValidationError } from '@/server/core/errors';
import { withActorTransaction } from '@/server/db/transaction';
import { resolveUserActor } from '@/server/modules/access/access.service';
import { setStorageProviderForTesting, uploadPhoto } from '@/server/modules/attachments/attachments.service';
import { createCustomer } from '@/server/modules/customers/customers.service';
import { getIncidentDetail, previewResolution, reportIncident, resolveIncident } from '@/server/modules/incidents/incidents.service';
import { createProduct, executeStockOperation, getCustomerBalances, getStockOverview } from '@/server/modules/inventory/inventory.service';
import { todayInSaoPaulo } from '@/server/modules/orders/orders.domain';
import { createOrderByStaff, getOrderDetail, transitionOrder } from '@/server/modules/orders/orders.service';
import { finishRoute, startRoute } from '@/server/modules/routes/driver-app.service';
import { createDriver, createVehicle, driverSchema, vehicleSchema } from '@/server/modules/routes/fleet.service';
import { completeStop, getStopServiceForm, listOperations, reportStopProblem } from '@/server/modules/routes/operations.service';
import { createRoute } from '@/server/modules/routes/routes.service';
import type { StorageProvider } from '@/server/providers/storage-provider';
import { customerCreateSchema } from '@/lib/validation/customers';
import { nextCnpj } from '../helpers/documents';
import { createOrg, createUserInOrg, sql } from './fixtures';

let org: string;
let admin: UserActor;
let manager: UserActor;
let driverUser: UserActor;
let otherDriverUser: UserActor;
let driverId: string;
let otherDriverId: string;
let product: string;
const today = todayInSaoPaulo();

async function actor(roles: string[], mfa = false) {
  const { userId } = await createUserInOrg(org, roles);
  return (await resolveUserActor({ userId, aal: mfa ? 'aal2' : 'aal1', lastTotpAt: mfa ? Math.floor(Date.now() / 1000) : undefined }, org))!;
}

async function newCustomer() {
  const { id } = await createCustomer(admin, customerCreateSchema.parse({ personType: 'PJ', legalName: 'Spa Operação', document: nextCnpj(), whatsapp: '+5561991234567' }));
  return id;
}

async function stock() {
  const o = await getStockOverview(admin);
  return o.products.find((p) => p.id === product)!.stock.byState;
}

async function customerHas(customerId: string) {
  return (await getCustomerBalances(admin, customerId)).find((b) => b.productId === product)?.quantity ?? 0;
}

type OrderType = 'DELIVERY' | 'COLLECTION' | 'DELIVERY_AND_COLLECTION';

/** Cria pedidos confirmados, monta a rota e inicia (carrega o veículo). Devolve paradas na ordem. */
async function startedRoute(orders: { customerId: string; type: OrderType; deliver: number; collect?: number }[], driver = { id: driverId, user: driverUser }) {
  const ids: string[] = [];
  for (const o of orders) {
    const { id } = await createOrderByStaff(manager, {
      customerId: o.customerId, type: o.type, scheduledDate: today, windowStart: null, windowEnd: null,
      items: [{ productId: product, deliveryQuantity: o.deliver, collectionQuantity: o.collect ?? 0 }],
      notes: null, internalNotes: null, confirmNow: true,
    });
    ids.push(id);
  }
  const { id: routeId } = await createRoute(manager, { routeDate: today, driverId: driver.id, orderIds: ids, notes: null });
  await startRoute(driver.user, routeId, null);
  const stops = await sql<{ id: string; order_id: string }[]>`select id, order_id from public.route_stops where route_id = ${routeId} order by sequence`;
  return { routeId, orderIds: ids, stopIds: stops.map((s) => s.id) };
}

function line(delivered: number, collected: number, damaged = 0, damageClass: 'TORN' | null = null) {
  return [{ productId: product, delivered, collected, damaged, damageClass }];
}

beforeAll(async () => {
  org = await createOrg('op');
  admin = await actor(['ADMIN'], true);
  manager = await actor(['MANAGER']);
  driverUser = await actor(['DRIVER']);
  otherDriverUser = await actor(['DRIVER']);
  ({ id: product } = await createProduct(admin, { sku: 'TOA-OP', name: 'Toalha operação', size: null, category: null, costCents: 0, replacementPriceCents: 1500, minStock: 0, active: true }));
  await executeStockOperation(admin, { kind: 'entry', productId: product, quantity: 1000, reason: 'Estoque inicial' });
  const { id: van } = await createVehicle(manager, vehicleSchema.parse({ plate: 'OPE1A23', model: 'Van', capacity: 1000 }));
  ({ id: driverId } = await createDriver(manager, driverSchema.parse({ fullName: 'Motorista Op', userId: driverUser.userId, defaultVehicleId: van })));
  ({ id: otherDriverId } = await createDriver(manager, driverSchema.parse({ fullName: 'Outro Op', userId: otherDriverUser.userId, defaultVehicleId: van })));
});

afterEach(() => setStorageProviderForTesting(undefined));

describe('entrega e coleta (SPEC §14)', () => {
  it('1000 disponíveis → entregar 100 → 900 disponíveis e 100 com o cliente; pedido concluído ao finalizar', async () => {
    const before = await stock();
    const customer = await newCustomer();
    const r = await startedRoute([{ customerId: customer, type: 'DELIVERY', deliver: 100 }]);
    const form = await getStopServiceForm(driverUser, r.stopIds[0]!);
    expect(form.lines[0]).toMatchObject({ plannedDelivery: 100, loaded: 100, expectedCollection: 0, customerBalance: 0 });

    await completeStop(driverUser, r.stopIds[0]!, { items: line(100, 0), recipientName: 'Ana (recepção)', notes: null, attachmentIds: [], geo: { latitude: -15.79, longitude: -47.88, accuracy: 12 } });
    expect(await customerHas(customer)).toBe(100);
    expect((await getOrderDetail(manager, r.orderIds[0]!)).order.status).toBe('DELIVERED');
    await finishRoute(driverUser, r.routeId, null);
    const after = await stock();
    expect(after.AVAILABLE).toBe(before.AVAILABLE - 100);
    expect(after.IN_ROUTE).toBe(before.IN_ROUTE);
    expect((await getOrderDetail(manager, r.orderIds[0]!)).order.status).toBe('COMPLETED');
    const [op] = await sql`select recipient_name, geolocation_status from public.stop_operations where route_stop_id = ${r.stopIds[0]!}`;
    expect(op).toMatchObject({ recipient_name: 'Ana (recepção)', geolocation_status: 'CAPTURED' });
    const [ev] = await sql`select count(*)::int as n from public.outbox_events where event_type = 'DeliveryCompleted' and aggregate_id = ${r.orderIds[0]!}`;
    expect(ev?.n).toBe(1);
  });

  it('divergência: saldo 100, coleta 94 → COLLECTION 94, 6 com o cliente, ocorrência e alerta', async () => {
    const customer = await newCustomer();
    const d = await startedRoute([{ customerId: customer, type: 'DELIVERY', deliver: 100 }]);
    await completeStop(driverUser, d.stopIds[0]!, { items: line(100, 0), recipientName: 'Ana', notes: null, attachmentIds: [], geo: null });
    await finishRoute(driverUser, d.routeId, null);

    const c = await startedRoute([{ customerId: customer, type: 'COLLECTION', deliver: 0, collect: 100 }]);
    const form = await getStopServiceForm(driverUser, c.stopIds[0]!);
    expect(form.lines[0]).toMatchObject({ expectedCollection: 100, customerBalance: 100 });
    const res = await completeStop(driverUser, c.stopIds[0]!, { items: line(0, 94), recipientName: 'Bruno', notes: null, attachmentIds: [], geo: null });

    expect(await customerHas(customer)).toBe(6);
    const [mv] = await sql`select quantity, to_state from public.towel_movements where route_stop_id = ${c.stopIds[0]!} and movement_type = 'COLLECTION'`;
    expect(mv).toMatchObject({ quantity: 94, to_state: 'AWAITING_LAUNDRY' });
    expect(res.incidents).toHaveLength(1);
    const inc = await getIncidentDetail(manager, res.incidents[0]!);
    expect(inc.incident).toMatchObject({ type: 'QUANTITY_DIVERGENCE', quantity: 6, status: 'OPEN' });
    const [alert] = await sql`select alert_type from public.system_alerts where dedupe_key = ${`INCIDENT:${res.incidents[0]!}`}`;
    expect(alert?.alert_type).toBe('QUANTITY_DIVERGENCE');

    // Perda cobrada: exatamente um fato cobrável (6 × R$ 15,00).
    const input = { decision: 'REGISTER_LOSS' as const, resolution: 'Cliente confirmou que perdeu', chargeCustomer: true };
    const preview = await previewResolution(manager, res.incidents[0]!, input);
    expect(preview.chargeAmountCents).toBe(9000);
    expect(preview.summary).toMatch(/6 toalhas .* perdidas .* saldo dele para 0 .* R\$\s?90,00/);
    const [r1, r2] = await Promise.allSettled([resolveIncident(manager, res.incidents[0]!, input), resolveIncident(manager, res.incidents[0]!, input)]);
    expect([r1.status, r2.status].sort()).toEqual(['fulfilled', 'rejected']);
    const bills = await sql`select amount_cents::int as a, quantity from public.billable_events where source_id = ${res.incidents[0]!}`;
    expect(bills).toEqual([{ a: 9000, quantity: 6 }]);
    expect(await customerHas(customer)).toBe(0);
    await finishRoute(driverUser, c.routeId, null);
  });

  it('entrega menor que a prevista: ocorrência e as toalhas voltam ao estoque ao finalizar', async () => {
    const before = await stock();
    const customer = await newCustomer();
    const r = await startedRoute([{ customerId: customer, type: 'DELIVERY', deliver: 10 }]);
    const res = await completeStop(driverUser, r.stopIds[0]!, { items: line(7, 0), recipientName: 'Carla', notes: 'Cliente pediu só 7', attachmentIds: [], geo: null });
    expect(res.incidents).toHaveLength(1);
    expect((await stock()).IN_ROUTE).toBe(before.IN_ROUTE + 3);
    const fin = await finishRoute(driverUser, r.routeId, null);
    expect(fin.returned).toBe(3);
    const after = await stock();
    expect(after.IN_ROUTE).toBe(before.IN_ROUTE);
    expect(after.AVAILABLE).toBe(before.AVAILABLE - 7);
  });

  it('problema na parada: pedido em DELIVERY_PROBLEM, toalhas voltam, pedido pode ser reagendado e reconfirmado', async () => {
    const before = await stock();
    const customer = await newCustomer();
    const r = await startedRoute([
      { customerId: customer, type: 'DELIVERY', deliver: 5 },
      { customerId: await newCustomer(), type: 'DELIVERY', deliver: 2 },
    ]);
    await expect(finishRoute(driverUser, r.routeId, null)).rejects.toThrow(/em aberto/);
    const p = await reportStopProblem(driverUser, r.stopIds[0]!, { type: 'CUSTOMER_CLOSED', description: 'Portão fechado às 10h', attachmentIds: [], geo: null });
    expect(p.stopStatus).toBe('FAILED');
    // Segunda parada ainda PENDING: pulada.
    const s2 = await reportStopProblem(driverUser, r.stopIds[1]!, { type: 'ADDRESS_PROBLEM', description: 'Número não existe', attachmentIds: [], geo: null });
    expect(s2.stopStatus).toBe('SKIPPED');
    expect((await getOrderDetail(manager, r.orderIds[0]!)).order.status).toBe('DELIVERY_PROBLEM');
    const fin = await finishRoute(driverUser, r.routeId, null);
    expect(fin.returned).toBe(7);
    expect((await stock()).AVAILABLE).toBe(before.AVAILABLE);

    await transitionOrder(manager, r.orderIds[0]!, { to: 'RESCHEDULED', reason: 'Nova tentativa', scheduledDate: today, overrideStock: false, windowStart: null, windowEnd: null });
    await transitionOrder(manager, r.orderIds[0]!, { to: 'CONFIRMED', overrideStock: false, windowStart: null, windowEnd: null });
    const again = await createRoute(manager, { routeDate: today, driverId, orderIds: [r.orderIds[0]!], notes: null });
    expect(again.id).toBeTruthy();
    await sql`update public.routes set status = 'CANCELLED' where id = ${again.id}`;
    await transitionOrder(manager, r.orderIds[1]!, { to: 'CANCELLED', reason: 'fim do teste', overrideStock: false, windowStart: null, windowEnd: null });
  });
});

describe('validações e isolamento do atendimento', () => {
  it('não entrega mais que carregou, não coleta mais que o saldo, exige recebedor e foto quando configurado; retry não duplica', async () => {
    const customer = await newCustomer();
    const r = await startedRoute([{ customerId: customer, type: 'DELIVERY_AND_COLLECTION', deliver: 4 }]);
    const stop = r.stopIds[0]!;
    await expect(completeStop(driverUser, stop, { items: line(5, 0), recipientName: 'Xu', notes: null, attachmentIds: [], geo: null })).rejects.toThrow(/só 4 saíram/);
    await expect(completeStop(driverUser, stop, { items: line(4, 1), recipientName: 'Xu', notes: null, attachmentIds: [], geo: null })).rejects.toThrow(/cliente tem 0/);
    await expect(completeStop(driverUser, stop, { items: line(4, 0), recipientName: null, notes: null, attachmentIds: [], geo: null })).rejects.toBeInstanceOf(ValidationError);
    await expect(completeStop(otherDriverUser, stop, { items: line(4, 0), recipientName: 'Xu', notes: null, attachmentIds: [], geo: null })).rejects.toBeInstanceOf(NotFoundError);

    await sql`update public.organizations set settings = settings || '{"operations":{"requireProofPhoto":true}}'::jsonb where id = ${org}`;
    await expect(completeStop(driverUser, stop, { items: line(4, 0), recipientName: 'Xu', notes: null, attachmentIds: [], geo: null })).rejects.toThrow(/Foto/);

    const uploaded: string[] = [];
    const fake: StorageProvider = {
      name: 'fake',
      upload: async (i) => {
        const path = `${i.prefix}/${randomUUID()}.jpg`;
        uploaded.push(path);
        return { bucket: i.bucket, path, contentType: i.contentType, sizeBytes: i.data.byteLength };
      },
      createSignedUrl: async () => 'https://example.test/signed',
    };
    setStorageProviderForTesting(fake);
    await expect(uploadPhoto(driverUser, new TextEncoder().encode('<script>alert(1)</script>'))).rejects.toThrow(/JPG, PNG ou WEBP/);
    await expect(uploadPhoto(manager, new Uint8Array(6 * 1024 * 1024).fill(0xff))).rejects.toThrow(/5 MB/);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    const photo = await uploadPhoto(driverUser, jpeg);
    const foreign = await uploadPhoto(otherDriverUser, jpeg);
    expect(uploaded[0]).toMatch(new RegExp(`^${org}/\\d{4}-\\d{2}/[0-9a-f-]{36}\\.jpg$`));
    // Foto de outra pessoa não pode ser usada.
    await expect(completeStop(driverUser, stop, { items: line(4, 0), recipientName: 'Xu', notes: null, attachmentIds: [foreign.id], geo: null })).rejects.toThrow(/Foto inválida/);

    const input = { items: line(4, 0), recipientName: 'Recepção', notes: null, attachmentIds: [photo.id], geo: null };
    const [a, b] = await Promise.all([completeStop(driverUser, stop, input), completeStop(driverUser, stop, input)]);
    expect(a.operationId).toBe(b.operationId);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    const [n] = await sql`select count(*)::int as n from public.towel_movements where route_stop_id = ${stop} and movement_type = 'DELIVERY'`;
    expect(n?.n).toBe(1);
    const [att] = await sql`select entity_type from public.attachments where id = ${photo.id}`;
    expect(att?.entity_type).toBe('stop_operation');
    await sql`update public.organizations set settings = settings || '{"operations":{"requireProofPhoto":false}}'::jsonb where id = ${org}`;
    await finishRoute(driverUser, r.routeId, null);
    const ops = await listOperations(manager, { customerId: customer, page: 1 });
    expect(ops.items[0]).toMatchObject({ recipientName: 'Recepção', delivered: 4, attachmentIds: [photo.id] });
  });

  it('dano na coleta: ocorrência DAMAGED; cobrar o cliente descarta e gera cobrança; motorista não vê cobranças nem resolve', async () => {
    const customer = await newCustomer();
    const d = await startedRoute([{ customerId: customer, type: 'DELIVERY', deliver: 10 }], { id: otherDriverId, user: otherDriverUser });
    await completeStop(otherDriverUser, d.stopIds[0]!, { items: line(10, 0), recipientName: 'Ana', notes: null, attachmentIds: [], geo: null });
    await finishRoute(otherDriverUser, d.routeId, null);
    const before = await stock();

    const c = await startedRoute([{ customerId: customer, type: 'COLLECTION', deliver: 0, collect: 10 }], { id: otherDriverId, user: otherDriverUser });
    await expect(
      completeStop(otherDriverUser, c.stopIds[0]!, { items: [{ productId: product, delivered: 0, collected: 10, damaged: 2 }], recipientName: 'Ana', notes: null, attachmentIds: [], geo: null }),
    ).rejects.toThrow(/tipo de dano/);
    const res = await completeStop(otherDriverUser, c.stopIds[0]!, { items: line(0, 10, 2, 'TORN'), recipientName: 'Ana', notes: null, attachmentIds: [], geo: null });
    const damaged = (await Promise.all(res.incidents.map((id) => getIncidentDetail(manager, id)))).find((x) => x.incident.type === 'DAMAGED')!;
    expect(damaged.incident).toMatchObject({ quantity: 2, damageClass: 'TORN' });
    expect(damaged.actions.decisions).toEqual(['RETURN_TO_LAUNDRY', 'RETURN_TO_STOCK', 'DISCARD', 'CHARGE_CUSTOMER']);

    await expect(resolveIncident(otherDriverUser, damaged.incident.id, { decision: 'DISCARD', resolution: 'x x x', chargeCustomer: false })).rejects.toBeInstanceOf(AuthorizationError);
    await resolveIncident(manager, damaged.incident.id, { decision: 'CHARGE_CUSTOMER', resolution: 'Rasgada pelo cliente', chargeCustomer: false });
    const after = await stock();
    expect(after.AWAITING_LAUNDRY).toBe(before.AWAITING_LAUNDRY + 8);
    expect(after.DISCARDED).toBe(before.DISCARDED + 2);
    const [bill] = await sql`select kind, amount_cents::int as a from public.billable_events where source_id = ${damaged.incident.id}`;
    expect(bill).toMatchObject({ kind: 'DAMAGE', a: 3000 });
    await expect(resolveIncident(manager, damaged.incident.id, { decision: 'DISCARD', resolution: 'de novo', chargeCustomer: false })).rejects.toBeInstanceOf(BusinessRuleError);

    const seen = await withActorTransaction({ type: 'USER', userId: otherDriverUser.userId, organizationId: org }, (tx) => tx`select id from public.billable_events`);
    expect(seen).toHaveLength(0);
    await finishRoute(otherDriverUser, c.routeId, null);
  });

  it('decidir com cobrança exige finance.create_charge; ocorrência manual da equipe', async () => {
    const [role] = await sql<{ id: string }[]>`
      insert into public.roles (organization_id, code, name, is_system) values (${org}, 'OCORRENCIAS', 'Ocorrências', false) returning id`;
    await sql`insert into public.role_permissions (organization_id, role_id, permission_code)
              select ${org}, ${role!.id}, unnest(array['admin.access', 'incident.read', 'incident.report', 'incident.manage', 'inventory.move', 'inventory.read', 'customer.read'])`;
    const noCharge = await actor(['OCORRENCIAS']);
    const customer = await newCustomer();
    await executeStockOperation(admin, { kind: 'adjust', productId: product, state: 'WITH_CUSTOMER', delta: 5, customerId: customer, reason: 'Saldo inicial do cliente' });
    const inc = await reportIncident(noCharge, { type: 'NOT_RETURNED', customerId: customer, productId: product, quantity: 3, description: 'Cliente não devolveu 3', attachmentIds: [] });
    const detail = await getIncidentDetail(noCharge, inc.id);
    expect(detail.actions.canCharge).toBe(false);
    await expect(resolveIncident(noCharge, inc.id, { decision: 'REGISTER_LOSS', resolution: 'Perda confirmada', chargeCustomer: true })).rejects.toBeInstanceOf(AuthorizationError);
    await resolveIncident(noCharge, inc.id, { decision: 'REGISTER_LOSS', resolution: 'Perda confirmada, sem cobrança', chargeCustomer: false });
    expect(await customerHas(customer)).toBe(2);
    const bills = await sql`select 1 from public.billable_events where source_id = ${inc.id}`;
    expect(bills).toHaveLength(0);
  });
});
