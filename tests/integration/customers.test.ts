import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { UserActor } from '@/server/auth/actor';
import { AuthorizationError, BusinessRuleError, ConflictError, NotFoundError, StepUpRequiredError } from '@/server/core/errors';
import { withActorTransaction } from '@/server/db/transaction';
import { resolveUserActor } from '@/server/modules/access/access.service';
import {
  anonymizeCustomer,
  changeCustomerStatus,
  createCustomer,
  getCustomer360,
  getOwnCustomer,
  insertNewCustomer,
  listCustomersForActor,
  setCustomerLocation,
  updateCustomerByStaff,
  updateOwnCustomer,
} from '@/server/modules/customers/customers.service';
import { geocodeCustomerHandler, setMapsProviderForTesting } from '@/server/modules/customers/geocoding.service';
import { linkCustomerUser } from '@/server/modules/customers/customers.repository';
import { customerCreateSchema } from '@/lib/validation/customers';
import type { JobRow } from '@/server/modules/jobs/jobs.repository';
import { nextCnpj, nextCpf } from '../helpers/documents';
import { createOrg, createUserInOrg, sql } from './fixtures';

let org: string;
let otherOrg: string;
let admin: UserActor;
let adminFresh: UserActor;
let manager: UserActor;
let driver: UserActor;
let adminOther: UserActor;

const NOW = () => Math.floor(Date.now() / 1000);

async function actorFor(orgId: string, roles: string[], mfa = false): Promise<UserActor> {
  const { userId } = await createUserInOrg(orgId, roles);
  return (await resolveUserActor({ userId, aal: mfa ? 'aal2' : 'aal1', lastTotpAt: mfa ? NOW() : undefined }, orgId))!;
}

function pj(extra: Record<string, unknown> = {}) {
  return customerCreateSchema.parse({
    personType: 'PJ',
    legalName: 'Salão Bela Vista',
    tradeName: 'Bela Vista',
    document: nextCnpj(),
    phone: '(11) 3333-4444',
    street: 'Av. Paulista',
    number: '1000',
    city: 'São Paulo',
    state: 'SP',
    whatsappOptIn: true,
    ...extra,
  });
}

beforeAll(async () => {
  org = await createOrg('cli');
  otherOrg = await createOrg('cli-b');
  admin = await actorFor(org, ['ADMIN'], true);
  adminFresh = admin;
  manager = await actorFor(org, ['MANAGER']);
  driver = await actorFor(org, ['DRIVER']);
  adminOther = await actorFor(otherOrg, ['ADMIN'], true);
});

async function jobsFor(customerId: string) {
  return sql<{ type: string; status: string }[]>`select type, status from public.jobs where payload->>'customerId' = ${customerId}`;
}

describe('cadastro de clientes', () => {
  it('admin cria cliente ativo com geocoding, outbox e auditoria', async () => {
    const data = pj();
    const { id } = await createCustomer(admin, data);
    const [row] = await sql`select status, source, geocode_status, consent_source, consent_updated_at is not null as consent from public.customers where id = ${id}`;
    expect(row).toMatchObject({ status: 'active', source: 'ADMIN', geocode_status: 'PENDING', consent_source: 'ADMIN', consent: true });
    expect(await jobsFor(id)).toEqual([{ type: 'customer.geocode', status: 'PENDING' }]);
    const [ev] = await sql`select event_type from public.outbox_events where aggregate_id = ${id}`;
    expect(ev?.event_type).toBe('CustomerCreated');
    const [audit] = await sql`select action from public.audit_logs where entity_id = ${id}`;
    expect(audit?.action).toBe('customer.created');
  });

  it('CPF/CNPJ é único por organização (mas pode repetir em outra)', async () => {
    const data = pj();
    await createCustomer(admin, data);
    await expect(createCustomer(manager, data)).rejects.toBeInstanceOf(ConflictError);
    await expect(createCustomer(adminOther, data)).resolves.toHaveProperty('id');
  });

  it('duplo clique com a mesma Idempotency-Key cria um único cliente', async () => {
    const data = pj();
    const key = `create-${randomUUID()}`;
    const [a, b] = await Promise.all([createCustomer(admin, data, key), createCustomer(admin, data, key)]);
    expect(a.id).toBe(b.id);
    const rows = await sql`select id from public.customers where document = ${data.document} and organization_id = ${org}`;
    expect(rows).toHaveLength(1);
  });

  it('motorista não acessa clientes (nem via RLS)', async () => {
    await expect(listCustomersForActor(driver, { limit: 10 })).rejects.toBeInstanceOf(AuthorizationError);
    const rows = await withActorTransaction({ type: 'USER', userId: driver.userId, organizationId: org }, (tx) => tx`select id from public.customers`);
    expect(rows).toHaveLength(0);
  });

  it('organização B não acessa cliente da A mesmo com o ID', async () => {
    const { id } = await createCustomer(admin, pj());
    await expect(getCustomer360(adminOther, id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateCustomerByStaff(adminOther, id, { legalName: 'Hack' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('alterar endereço limpa coordenadas, reenfileira geocoding e audita o diff', async () => {
    const { id } = await createCustomer(admin, pj());
    await sql`update public.customers set latitude = -23.5, longitude = -46.6, geocode_status = 'OK' where id = ${id}`;
    await updateCustomerByStaff(manager, id, { city: 'Campinas', legalName: 'Salão Bela Vista' });
    const [c] = await sql`select city, latitude, geocode_status from public.customers where id = ${id}`;
    expect(c).toMatchObject({ city: 'Campinas', latitude: null, geocode_status: 'PENDING' });
    expect((await jobsFor(id)).length).toBe(2);
    const [audit] = await sql<{ before: unknown; after: unknown }[]>`
      select before, after from public.audit_logs where entity_id = ${id} and action = 'customer.updated'`;
    expect(audit).toEqual({ before: { city: 'São Paulo' }, after: { city: 'Campinas' } });
  });

  it('status: aprovação, suspensão e transição inválida', async () => {
    const id = await withActorTransaction({ type: 'USER', userId: admin.userId, organizationId: org }, (tx) =>
      insertNewCustomer(tx, org, pj(), { status: 'pending', source: 'SELF_SIGNUP', consentSource: 'SELF_SIGNUP', createdBy: null }),
    );
    await expect(changeCustomerStatus(manager, id, 'suspend', 'teste')).rejects.toBeInstanceOf(BusinessRuleError);
    await changeCustomerStatus(manager, id, 'approve', 'documentos ok');
    await changeCustomerStatus(manager, id, 'suspend', 'inadimplência');
    const [c] = await sql`select status, status_reason, approved_by from public.customers where id = ${id}`;
    expect(c).toMatchObject({ status: 'suspended', status_reason: 'inadimplência', approved_by: manager.userId });
    const events = await sql`select event_type from public.outbox_events where aggregate_id = ${id} and event_type = 'CustomerStatusChanged'`;
    expect(events).toHaveLength(2);
  });

  it('busca por nome, documento e telefone', async () => {
    const doc = nextCnpj();
    await createCustomer(admin, pj({ legalName: 'Academia Força Total', document: doc, phone: '(19) 3232-1111' }));
    const byName = await listCustomersForActor(manager, { search: 'força total', limit: 10 });
    expect(byName.items.map((i) => i.document)).toContain(doc);
    const byDoc = await listCustomersForActor(manager, { search: doc.slice(0, 8), limit: 10 });
    expect(byDoc.items.map((i) => i.document)).toContain(doc);
    const byPhone = await listCustomersForActor(manager, { search: '3232-1111', limit: 10 });
    expect(byPhone.items.map((i) => i.document)).toContain(doc);
    expect(byName.counts?.active).toBeGreaterThan(0);
  });
});

describe('geocoding', () => {
  const job = (customerId: string) => ({ job: { payload: { customerId } } as unknown as JobRow });

  it('grava coordenadas, marca parcial e não sobrescreve correção manual', async () => {
    const { id } = await createCustomer(admin, pj());
    setMapsProviderForTesting({
      name: 'fake',
      geocode: async () => ({ lat: -23.561, lng: -46.656, placeId: 'place-1', formattedAddress: 'Av. Paulista, 1000', partialMatch: true }),
      optimizeRoute: async () => ({ orderedStopIds: [], distanceMeters: 0, durationSeconds: 0 }),
    });
    await geocodeCustomerHandler(job(id));
    let [c] = await sql`select latitude::float8 as lat, place_id, geocode_status from public.customers where id = ${id}`;
    expect(c).toMatchObject({ lat: -23.561, place_id: 'place-1', geocode_status: 'PARTIAL' });

    await setCustomerLocation(manager, id, { latitude: -23.56, longitude: -46.65, reason: 'Portão pela rua lateral' });
    setMapsProviderForTesting({
      name: 'fake',
      geocode: async () => ({ lat: 0, lng: 0, placeId: 'x', formattedAddress: 'x', partialMatch: false }),
      optimizeRoute: async () => ({ orderedStopIds: [], distanceMeters: 0, durationSeconds: 0 }),
    });
    await geocodeCustomerHandler(job(id));
    [c] = await sql`select latitude::float8 as lat, geocode_status from public.customers where id = ${id}`;
    expect(c).toMatchObject({ lat: -23.56, geocode_status: 'MANUAL' });
  });

  it('endereço não encontrado → NOT_FOUND; sem provider → continua PENDING', async () => {
    const { id } = await createCustomer(admin, pj());
    setMapsProviderForTesting(null);
    await geocodeCustomerHandler(job(id));
    expect((await sql`select geocode_status from public.customers where id = ${id}`)[0]?.geocode_status).toBe('PENDING');
    setMapsProviderForTesting({
      name: 'fake',
      geocode: async () => null,
      optimizeRoute: async () => ({ orderedStopIds: [], distanceMeters: 0, durationSeconds: 0 }),
    });
    await geocodeCustomerHandler(job(id));
    expect((await sql`select geocode_status from public.customers where id = ${id}`)[0]?.geocode_status).toBe('NOT_FOUND');
    setMapsProviderForTesting(undefined);
  });
});

describe('portal do cliente', () => {
  it('cliente A só vê e altera o próprio cadastro', async () => {
    const { id: idA } = await createCustomer(admin, pj());
    const { id: idB } = await createCustomer(admin, pj());
    const { userId } = await createUserInOrg(org, ['CUSTOMER']);
    await withActorTransaction({ type: 'USER', userId: admin.userId, organizationId: org }, (tx) => linkCustomerUser(tx, org, idA, userId));
    const customerA = (await resolveUserActor({ userId, aal: 'aal1' }, org))!;

    expect((await getOwnCustomer(customerA)).id).toBe(idA);
    const visible = await withActorTransaction({ type: 'USER', userId, organizationId: org }, (tx) => tx<{ id: string }[]>`select id from public.customers`);
    expect(visible.map((v) => v.id)).toEqual([idA]);
    await expect(getCustomer360(customerA, idB)).rejects.toBeInstanceOf(AuthorizationError);

    await updateOwnCustomer(customerA, { whatsapp: '+5511987654321', whatsappOptIn: false });
    const [c] = await sql`select whatsapp, whatsapp_opt_in, consent_source from public.customers where id = ${idA}`;
    expect(c).toMatchObject({ whatsapp: '+5511987654321', whatsapp_opt_in: false, consent_source: 'PORTAL' });
    // Tentativa direta (fora do service) de alterar outro cliente é barrada pelo RLS.
    const res = await withActorTransaction({ type: 'USER', userId, organizationId: org }, (tx) =>
      tx`update public.customers set legal_name = 'Hack' where id = ${idB}`,
    );
    expect(res.count).toBe(0);
  });
});

describe('LGPD', () => {
  it('anonimização exige step-up e remove dados pessoais sem gravá-los na auditoria', async () => {
    const data = pj({ email: 'contato@bela.com.br' });
    const { id } = await createCustomer(admin, data);
    const stale: UserActor = { ...adminFresh, mfa: { ...adminFresh.mfa, lastTotpAt: NOW() - 3600 } };
    await expect(anonymizeCustomer(stale, id, 'pedido do titular')).rejects.toBeInstanceOf(StepUpRequiredError);
    await expect(anonymizeCustomer(manager, id, 'x')).rejects.toBeInstanceOf(AuthorizationError);

    await anonymizeCustomer(adminFresh, id, 'pedido do titular');
    const [c] = await sql`select legal_name, document, email, phone, street, status, anonymized_at is not null as anon from public.customers where id = ${id}`;
    expect(c).toMatchObject({ legal_name: 'Cliente anonimizado', document: null, email: null, phone: null, street: null, status: 'inactive', anon: true });
    const [audit] = await sql<{ before: unknown; after: unknown }[]>`select before, after from public.audit_logs where entity_id = ${id} and action = 'customer.anonymized'`;
    expect(JSON.stringify(audit)).not.toContain('contato@bela.com.br');
    expect(JSON.stringify(audit)).not.toContain(data.document);
    await expect(updateCustomerByStaff(admin, id, { legalName: 'Volta' })).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('cliente não pode ser apagado fisicamente', async () => {
    const { id } = await createCustomer(admin, pj({ document: nextCpf(), personType: 'PF', legalName: 'Maria Souza' }));
    await expect(sql`delete from public.customers where id = ${id}`).rejects.toThrow(/append-only/);
  });
});
