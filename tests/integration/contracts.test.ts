import { beforeAll, describe, expect, it } from 'vitest';
import type { UserActor } from '@/server/auth/actor';
import { AuthorizationError, BusinessRuleError, ConflictError, ValidationError } from '@/server/core/errors';
import { resolveUserActor } from '@/server/modules/access/access.service';
import {
  createContract,
  createContractSchema,
  getContractDetail,
  getOwnContract,
  processRenewals,
  simulateContractBilling,
  transitionContract,
  updateContract,
  updateContractSchema,
} from '@/server/modules/contracts/contracts.service';
import { createCustomer } from '@/server/modules/customers/customers.service';
import { linkCustomerUser } from '@/server/modules/customers/customers.repository';
import { reportIncident, resolveIncident } from '@/server/modules/incidents/incidents.service';
import { createProduct } from '@/server/modules/inventory/inventory.service';
import { todayInSaoPaulo } from '@/server/modules/orders/orders.domain';
import { createOrderByStaff } from '@/server/modules/orders/orders.service';
import { finishRoute, startRoute } from '@/server/modules/routes/driver-app.service';
import { createDriver, createVehicle, driverSchema, vehicleSchema } from '@/server/modules/routes/fleet.service';
import { completeStop } from '@/server/modules/routes/operations.service';
import { createRoute } from '@/server/modules/routes/routes.service';
import { withActorTransaction } from '@/server/db/transaction';
import { customerCreateSchema } from '@/lib/validation/customers';
import { nextCnpj } from '../helpers/documents';
import { createOrg, createUserInOrg, sql } from './fixtures';

let org: string;
let admin: UserActor;
let manager: UserActor;
let driverUser: UserActor;
let driverId: string;
let product: string;
const today = todayInSaoPaulo();
const month = today.slice(0, 7);

async function actor(roles: string[], mfa = false) {
  const { userId } = await createUserInOrg(org, roles);
  return (await resolveUserActor({ userId, aal: mfa ? 'aal2' : 'aal1', lastTotpAt: mfa ? Math.floor(Date.now() / 1000) : undefined }, org))!;
}

async function newCustomer() {
  const { id } = await createCustomer(admin, customerCreateSchema.parse({ personType: 'PJ', legalName: 'Clínica Contrato', document: nextCnpj() }));
  return id;
}

function hybrid(customerId: string, extra: Record<string, unknown> = {}) {
  return createContractSchema.parse({
    customerId, billingType: 'HYBRID', startsOn: `${month}-01`, dueDay: 10, monthlyFeeCents: 50_000,
    items: [{ productId: product, contractedQuantity: 100, franchiseQuantity: 50, excessPriceCents: 300, lossPriceCents: 2_500 }],
    ...extra,
  });
}

async function deliver(customerId: string, qty: number) {
  const { id: orderId } = await createOrderByStaff(manager, {
    customerId, type: 'DELIVERY', scheduledDate: today, windowStart: null, windowEnd: null,
    items: [{ productId: product, deliveryQuantity: qty, collectionQuantity: 0 }], notes: null, internalNotes: null, confirmNow: true,
  });
  const { id: routeId } = await createRoute(manager, { routeDate: today, driverId, orderIds: [orderId], notes: null });
  await startRoute(driverUser, routeId, null);
  const [stop] = await sql<{ id: string }[]>`select id from public.route_stops where route_id = ${routeId}`;
  await completeStop(driverUser, stop!.id, { items: [{ productId: product, delivered: qty, collected: 0, damaged: 0 }], recipientName: 'Recepção', notes: null, attachmentIds: [], geo: null });
  await finishRoute(driverUser, routeId, null);
}

beforeAll(async () => {
  org = await createOrg('ctr');
  admin = await actor(['ADMIN'], true);
  manager = await actor(['MANAGER']);
  driverUser = await actor(['DRIVER']);
  ({ id: product } = await createProduct(admin, { sku: 'TOA-CTR', name: 'Toalha contrato', size: null, category: null, costCents: 0, replacementPriceCents: 1_500, minStock: 0, active: true, initialQuantity: 500 }));
  const { id: van } = await createVehicle(manager, vehicleSchema.parse({ plate: 'CTR1A23', model: 'Van', capacity: 1000 }));
  ({ id: driverId } = await createDriver(manager, driverSchema.parse({ fullName: 'Motorista Ctr', userId: driverUser.userId, defaultVehicleId: van })));
});

describe('ciclo de vida do contrato', () => {
  it('rascunho → ativo, um vigente por cliente, alteração de vigente exige motivo e gera revisão', async () => {
    const customer = await newCustomer();
    const { id, number } = await createContract(manager, hybrid(customer));
    expect(number).toMatch(/^CT-\d{5}$/);
    await transitionContract(manager, id, { to: 'ACTIVE', reason: null });

    const other = await createContract(manager, hybrid(customer));
    await expect(transitionContract(manager, other.id, { to: 'ACTIVE', reason: null })).rejects.toBeInstanceOf(ConflictError);
    await transitionContract(manager, other.id, { to: 'CANCELLED', reason: 'Duplicado' });

    const { customerId: _c, ...terms } = hybrid(customer);
    const patch = updateContractSchema.parse({ ...terms, monthlyFeeCents: 55_000, reason: null });
    await expect(updateContract(manager, id, patch)).rejects.toBeInstanceOf(ValidationError);
    await updateContract(manager, id, { ...patch, reason: 'Reajuste anual IPCA' });
    const d = await getContractDetail(manager, id);
    expect(d.contract).toMatchObject({ status: 'ACTIVE', monthlyFeeCents: 55_000, revision: 3 });
    expect(d.revisions.map((r) => r.changeType)).toEqual(['UPDATED', 'STATUS_ACTIVE', 'CREATED']);
    const [audit] = await sql`select before->>'monthlyFeeCents' as b, after->>'monthlyFeeCents' as a from public.audit_logs where entity_id = ${id} and action = 'contract.updated'`;
    expect(audit).toMatchObject({ b: '50000', a: '55000' });

    await expect(transitionContract(manager, id, { to: 'DRAFT' as never, reason: null })).rejects.toThrow();
    await transitionContract(manager, id, { to: 'ENDED', reason: 'Cliente encerrou' });
    await expect(updateContract(manager, id, { ...patch, reason: 'depois do fim' })).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('regras por tipo e cliente pendente: não ativa', async () => {
    const pending = (await createCustomer(admin, customerCreateSchema.parse({ personType: 'PJ', legalName: 'Pendente', document: nextCnpj() }))).id;
    await sql`update public.customers set status = 'pending' where id = ${pending}`;
    const { id } = await createContract(manager, hybrid(pending));
    await expect(transitionContract(manager, id, { to: 'ACTIVE', reason: null })).rejects.toThrow(/cadastro do cliente/);
    await expect(createContract(manager, { ...hybrid(pending), billingType: 'MONTHLY_FIXED', monthlyFeeCents: 0, items: [] })).rejects.toThrow(/mensalidade/);
    await expect(createContract(driverUser, hybrid(pending))).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe('cálculo com uso real e preço de perda do contrato', () => {
  it('HYBRID: franquia 50, entregues 80 → mensalidade + 30 × R$ 3,00; perda cobrada pelo preço do contrato', async () => {
    const customer = await newCustomer();
    const { id } = await createContract(manager, hybrid(customer));
    await transitionContract(manager, id, { to: 'ACTIVE', reason: null });
    await deliver(customer, 80);

    const sim = await simulateContractBilling(manager, id, month);
    expect(sim.usage).toMatchObject({ deliveries: 1, deliveredByProduct: { [product]: 80 } });
    expect(sim.billing.lines.map((l) => [l.kind, l.amountCents])).toEqual([['MONTHLY_FEE', 50_000], ['EXCESS', 9_000]]);
    expect(sim.billing.totalCents).toBe(59_000);

    const inc = await reportIncident(manager, { type: 'NOT_RETURNED', customerId: customer, productId: product, quantity: 4, description: 'Não devolveu 4', attachmentIds: [] });
    await resolveIncident(manager, inc.id, { decision: 'REGISTER_LOSS', resolution: 'Perda confirmada', chargeCustomer: true });
    const [bill] = await sql`select unit_price_cents::int as u, amount_cents::int as a from public.billable_events where source_id = ${inc.id}`;
    expect(bill).toEqual({ u: 2_500, a: 10_000 });
  });
});

describe('renovação e portal', () => {
  it('renovação automática estende; manual encerra; rodar de novo não faz nada', async () => {
    const c1 = await newCustomer();
    const c2 = await newCustomer();
    const auto = await createContract(manager, hybrid(c1, { startsOn: '2025-01-01', endsOn: '2025-12-31', renewal: 'AUTO', renewalMonths: 12 }));
    const manual = await createContract(manager, hybrid(c2, { startsOn: '2025-01-01', endsOn: '2026-06-30', renewal: 'MANUAL' }));
    // Ativa com vigência válida e depois simula a passagem do tempo.
    await sql`update public.contracts set status = 'ACTIVE', activated_at = now() where id in (${auto.id}, ${manual.id})`;
    const r = await processRenewals(org, '2027-02-01');
    expect(r).toEqual({ renewed: 1, ended: 1 });
    const [a] = await sql`select ends_on::text as e, status from public.contracts where id = ${auto.id}`;
    expect(a).toEqual({ e: '2027-12-31', status: 'ACTIVE' });
    const [m] = await sql`select status from public.contracts where id = ${manual.id}`;
    expect(m?.status).toBe('ENDED');
    expect(await processRenewals(org, '2027-02-01')).toEqual({ renewed: 0, ended: 0 });
  });

  it('cliente vê o próprio contrato vigente sem notas internas; não vê rascunho nem contrato de outro', async () => {
    const mine = await newCustomer();
    const other = await newCustomer();
    const { userId } = await createUserInOrg(org, ['CUSTOMER']);
    await withActorTransaction({ type: 'USER', userId: admin.userId, organizationId: org }, (tx) => linkCustomerUser(tx, org, mine, userId));
    const portal = (await resolveUserActor({ userId, aal: 'aal1' }, org))!;

    const draft = await createContract(manager, hybrid(mine, { notes: 'nota interna sigilosa' }));
    expect(await getOwnContract(portal)).toBeNull();
    await transitionContract(manager, draft.id, { to: 'ACTIVE', reason: null });
    const own = await getOwnContract(portal);
    expect(own?.contract.id).toBe(draft.id);
    expect(JSON.stringify(own)).not.toContain('sigilosa');

    const theirs = await createContract(manager, hybrid(other));
    await transitionContract(manager, theirs.id, { to: 'ACTIVE', reason: null });
    const seen = await withActorTransaction({ type: 'USER', userId, organizationId: org }, (tx) => tx`select id from public.contracts where id = ${theirs.id}`);
    expect(seen).toHaveLength(0);
    await expect(getContractDetail(portal, draft.id)).rejects.toBeInstanceOf(AuthorizationError);
  });
});
