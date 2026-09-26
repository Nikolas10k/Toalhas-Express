import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  CustomerCreateData,
  CustomerUpdateData,
  PortalCustomerUpdate,
} from '@/lib/validation/customers';
import { toDbContext, type AuthenticatedActor, type UserActor } from '@/server/auth/actor';
import { authorize } from '@/server/authz/authorize';
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '@/server/core/errors';
import type { Tx } from '@/server/db/client';
import { isUniqueViolation, withActorTransaction } from '@/server/db/transaction';
import { recordAudit } from '@/server/modules/audit/audit.service';
import { executeIdempotent } from '@/server/modules/idempotency/idempotency.service';
import { enqueueJob } from '@/server/modules/jobs/jobs.service';
import { recordOutboxEvent } from '@/server/modules/outbox/outbox.service';
import {
  addressChanged,
  diffFields,
  hasGeocodableAddress,
  resolveStatusAction,
  type CustomerStatus,
  type CustomerStatusAction,
} from './customers.domain';
import {
  countCustomersByStatus,
  findCustomerById,
  insertCustomer,
  listCustomers,
  listCustomerUsers,
  updateCustomer,
  type Customer,
  type CustomerWrite,
} from './customers.repository';
import { enqueueCustomerGeocode, GEOCODE_PENDING_JOB } from './geocoding.service';

const DUPLICATE_DOCUMENT = 'Já existe um cliente com este CPF/CNPJ nesta organização.';

/** Visão pública do cliente para a API (datas em ISO). */
export function toCustomerDto(c: Customer) {
  return {
    ...c,
    geocodedAt: c.geocodedAt?.toISOString() ?? null,
    consentUpdatedAt: c.consentUpdatedAt?.toISOString() ?? null,
    statusChangedAt: c.statusChangedAt?.toISOString() ?? null,
    approvedAt: c.approvedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    anonymizedAt: c.anonymizedAt?.toISOString() ?? null,
  };
}
export type CustomerDto = ReturnType<typeof toCustomerDto>;

export interface NewCustomerOptions {
  status: CustomerStatus;
  source: Customer['source'];
  consentSource: 'ADMIN' | 'SELF_SIGNUP' | 'IMPORT' | 'INTEGRATION';
  createdBy: string | null;
  importId?: string | null;
  approvedBy?: string | null;
}

/**
 * Inserção de cliente reutilizada por cadastro admin, auto cadastro e
 * importação. Roda dentro da transação do chamador: grava cliente, geocoding
 * pendente, outbox e (quem chama) auditoria.
 */
export async function insertNewCustomer(
  tx: Tx,
  organizationId: string,
  data: CustomerCreateData,
  opts: NewCustomerOptions,
): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  const geocodable = hasGeocodableAddress(data);
  const write: CustomerWrite = {
    ...data,
    status: opts.status,
    statusChangedAt: now,
    approvedAt: opts.status === 'active' ? now : null,
    approvedBy: opts.status === 'active' ? (opts.approvedBy ?? null) : null,
    source: opts.source,
    importId: opts.importId ?? null,
    createdBy: opts.createdBy,
    geocodeStatus: geocodable ? 'PENDING' : 'SKIPPED',
    consentUpdatedAt: data.whatsappOptIn || data.emailOptIn ? now : null,
    consentSource: data.whatsappOptIn || data.emailOptIn ? opts.consentSource : null,
  };
  try {
    await tx`savepoint customer_insert`;
    await insertCustomer(tx, id, organizationId, write);
    await tx`release savepoint customer_insert`;
  } catch (err) {
    await tx`rollback to savepoint customer_insert`;
    if (isUniqueViolation(err, 'customers_org_document_uidx')) throw new ConflictError(DUPLICATE_DOCUMENT);
    throw err;
  }
  if (geocodable) await enqueueCustomerGeocode(tx, organizationId, id, 'created');
  await recordOutboxEvent(tx, {
    organizationId,
    eventType: 'CustomerCreated',
    aggregateType: 'customer',
    aggregateId: id,
    payload: { customer_id: id, status: opts.status, source: opts.source },
    idempotencyKey: `CustomerCreated:${id}`,
  });
  return id;
}

/** Cadastro por admin/gerente. Idempotente quando há Idempotency-Key. */
export async function createCustomer(actor: UserActor, data: CustomerCreateData, idempotencyKey?: string) {
  authorize(actor, 'customer.create');
  const run = async (tx: Tx) => {
    const id = await insertNewCustomer(tx, actor.organizationId, data, {
      status: 'active',
      source: 'ADMIN',
      consentSource: 'ADMIN',
      createdBy: actor.userId,
      approvedBy: actor.userId,
    });
    await recordAudit(tx, actor, actor.organizationId, {
      action: 'customer.created',
      entityType: 'customer',
      entityId: id,
      after: data,
    });
    return { id };
  };
  if (idempotencyKey) {
    const { result } = await executeIdempotent(actor, { scope: 'customer.create', key: idempotencyKey, request: data }, run);
    return result;
  }
  return withActorTransaction(toDbContext(actor), run);
}

async function loadForUpdate(tx: Tx, id: string): Promise<Customer> {
  const c = await findCustomerById(tx, id, { forUpdate: true });
  if (!c) throw new NotFoundError('Cliente não encontrado.');
  if (c.anonymizedAt) throw new BusinessRuleError('Cliente anonimizado não pode ser alterado.');
  return c;
}

/** Aplica um patch já validado; recalcula geocoding e consentimento. */
async function applyPatch(
  tx: Tx,
  actor: AuthenticatedActor,
  current: Customer,
  patch: Record<string, unknown>,
  auditAction: string,
  consentSource: 'ADMIN' | 'PORTAL',
) {
  const { before, after } = diffFields(current as unknown as Record<string, unknown>, patch);
  if (Object.keys(after).length === 0) return { changed: false };

  const write: CustomerWrite = { ...after };
  const reGeocode = addressChanged(current as unknown as Record<string, unknown>, after);
  if (reGeocode) {
    const merged = { ...current, ...after } as Customer;
    Object.assign(write, {
      latitude: null,
      longitude: null,
      placeId: null,
      formattedAddress: null,
      geocodedAt: null,
      geocodeStatus: hasGeocodableAddress(merged) ? 'PENDING' : 'SKIPPED',
    });
  }
  if ('whatsappOptIn' in after || 'emailOptIn' in after) {
    Object.assign(write, { consentUpdatedAt: new Date(), consentSource });
  }
  await updateCustomer(tx, current.id, write);
  if (reGeocode && write.geocodeStatus === 'PENDING') {
    await enqueueCustomerGeocode(tx, current.organizationId, current.id, randomUUID());
  }
  await recordAudit(tx, actor, current.organizationId, {
    action: auditAction,
    entityType: 'customer',
    entityId: current.id,
    before,
    after,
  });
  return { changed: true };
}

export async function updateCustomerByStaff(actor: UserActor, id: string, patch: CustomerUpdateData) {
  authorize(actor, 'customer.update');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const current = await loadForUpdate(tx, id);
    return applyPatch(tx, actor, current, patch as Record<string, unknown>, 'customer.updated', 'ADMIN');
  });
}

export async function changeCustomerStatus(
  actor: UserActor,
  id: string,
  action: CustomerStatusAction,
  reason: string,
) {
  authorize(actor, action === 'approve' || action === 'reject' ? 'customer.approve' : 'customer.update');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const current = await loadForUpdate(tx, id);
    const target = resolveStatusAction(current.status, action);
    const now = new Date();
    await updateCustomer(tx, id, {
      status: target,
      statusReason: reason,
      statusChangedAt: now,
      ...(action === 'approve' ? { approvedAt: now, approvedBy: actor.userId } : {}),
    });
    await recordAudit(tx, actor, actor.organizationId, {
      action: 'customer.status_changed',
      entityType: 'customer',
      entityId: id,
      before: { status: current.status },
      after: { status: target },
      metadata: { action, reason },
    });
    await recordOutboxEvent(tx, {
      organizationId: actor.organizationId,
      eventType: 'CustomerStatusChanged',
      aggregateType: 'customer',
      aggregateId: id,
      payload: { customer_id: id, from: current.status, to: target, action },
      idempotencyKey: `CustomerStatusChanged:${id}:${now.toISOString()}`,
    });
    return { status: target };
  });
}

export async function setCustomerLocation(
  actor: UserActor,
  id: string,
  input: { latitude: number; longitude: number; reason: string },
) {
  authorize(actor, 'customer.update');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const current = await loadForUpdate(tx, id);
    await updateCustomer(tx, id, {
      latitude: input.latitude,
      longitude: input.longitude,
      geocodeStatus: 'MANUAL',
      geocodedAt: new Date(),
    });
    await recordAudit(tx, actor, actor.organizationId, {
      action: 'customer.location_corrected',
      entityType: 'customer',
      entityId: id,
      before: { latitude: current.latitude, longitude: current.longitude, geocode_status: current.geocodeStatus },
      after: { latitude: input.latitude, longitude: input.longitude, geocode_status: 'MANUAL' },
      metadata: { reason: input.reason },
    });
    return { geocodeStatus: 'MANUAL' };
  });
}

/** Refaz o geocoding (descarta correção manual). */
export async function requestCustomerGeocode(actor: UserActor, id: string) {
  authorize(actor, 'customer.update');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const current = await loadForUpdate(tx, id);
    if (!hasGeocodableAddress(current)) {
      throw new BusinessRuleError('Endereço incompleto: informe rua, cidade e UF, ou o CEP.');
    }
    await updateCustomer(tx, id, { geocodeStatus: 'PENDING' });
    await enqueueCustomerGeocode(tx, actor.organizationId, id, randomUUID());
    await recordAudit(tx, actor, actor.organizationId, {
      action: 'customer.geocode_requested',
      entityType: 'customer',
      entityId: id,
    });
    return { geocodeStatus: 'PENDING' };
  });
}

export async function requestBulkGeocode(actor: UserActor) {
  authorize(actor, 'customer.update');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const enqueued = await enqueueJob(tx, {
      type: GEOCODE_PENDING_JOB,
      organizationId: actor.organizationId,
      idempotencyKey: `${GEOCODE_PENDING_JOB}:${actor.organizationId}:${new Date().toISOString().slice(0, 16)}`,
      maxAttempts: 3,
    });
    await recordAudit(tx, actor, actor.organizationId, {
      action: 'customer.bulk_geocode_requested',
      entityType: 'customer',
      entityId: null,
    });
    return { enqueued };
  });
}

// -----------------------------------------------------------------------------
// Consultas
// -----------------------------------------------------------------------------

const CURSOR_TS = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)$/;

export const customerListQuerySchema = z.strictObject({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['pending', 'active', 'suspended', 'inactive']).optional(),
  geocodeStatus: z.enum(['PENDING', 'OK', 'PARTIAL', 'NOT_FOUND', 'FAILED', 'MANUAL', 'SKIPPED']).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;

function decodeCursor(cursor: string) {
  try {
    const [ts, id] = z
      .tuple([z.string().regex(CURSOR_TS), z.uuid()])
      .parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    return { createdAt: ts, id };
  } catch {
    throw new ValidationError('Cursor inválido.', [{ path: 'cursor', message: 'inválido' }]);
  }
}

export async function listCustomersForActor(actor: AuthenticatedActor, q: CustomerListQuery) {
  authorize(actor, 'customer.read');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const rows = await listCustomers(tx, {
      search: q.search,
      status: q.status,
      geocodeStatus: q.geocodeStatus,
      cursor: q.cursor ? decodeCursor(q.cursor) : undefined,
      limit: q.limit + 1,
    });
    const hasMore = rows.length > q.limit;
    const items = hasMore ? rows.slice(0, q.limit) : rows;
    const last = items.at(-1);
    return {
      items: items.map(({ cursorTs: _c, ...c }) => toCustomerDto(c)),
      nextCursor: hasMore && last ? Buffer.from(JSON.stringify([last.cursorTs, last.id])).toString('base64url') : null,
      counts: q.cursor ? undefined : await countCustomersByStatus(tx),
    };
  });
}

/** Visão 360°: dados do cliente + vínculos. Abas de outras fases vêm vazias. */
export async function getCustomer360(actor: UserActor, id: string) {
  authorize(actor, 'customer.read');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const c = await findCustomerById(tx, id);
    if (!c) throw new NotFoundError('Cliente não encontrado.');
    const users = await listCustomerUsers(tx, id);
    return {
      customer: toCustomerDto(c),
      portalUsers: users.map((u) => ({ userId: u.user_id, name: u.full_name, since: u.created_at.toISOString() })),
    };
  });
}

// -----------------------------------------------------------------------------
// LGPD
// -----------------------------------------------------------------------------

/** Exporta os dados pessoais de um cliente (pedido do titular). Exige step-up. */
export async function exportCustomerData(actor: UserActor, id: string) {
  authorize(actor, 'customer.export');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const c = await findCustomerById(tx, id);
    if (!c) throw new NotFoundError('Cliente não encontrado.');
    const users = await listCustomerUsers(tx, id);
    await recordAudit(tx, actor, actor.organizationId, {
      action: 'customer.data_exported',
      entityType: 'customer',
      entityId: id,
    });
    return {
      exportedAt: new Date().toISOString(),
      customer: toCustomerDto(c),
      portalUsers: users.map((u) => ({ userId: u.user_id, name: u.full_name })),
    };
  });
}

const PERSONAL_FIELDS: (keyof CustomerWrite)[] = [
  'tradeName', 'document', 'contactName', 'phone', 'whatsapp', 'email', 'postalCode', 'street', 'number',
  'complement', 'district', 'city', 'state', 'latitude', 'longitude', 'placeId', 'formattedAddress', 'notes',
];

/**
 * Anonimiza dados pessoais mantendo o registro (e o id) para preservar a
 * integridade de pedidos e registros financeiros sujeitos a retenção legal.
 * Irreversível. Exige step-up.
 */
export async function anonymizeCustomer(actor: UserActor, id: string, reason: string) {
  authorize(actor, 'customer.anonymize');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const current = await loadForUpdate(tx, id);
    const write: CustomerWrite = Object.fromEntries(PERSONAL_FIELDS.map((f) => [f, null]));
    Object.assign(write, {
      legalName: 'Cliente anonimizado',
      whatsappOptIn: false,
      emailOptIn: false,
      preferredChannel: 'NONE',
      consentUpdatedAt: new Date(),
      geocodeStatus: 'SKIPPED',
      status: 'inactive',
      statusReason: 'Anonimizado (LGPD)',
      statusChangedAt: new Date(),
      anonymizedAt: new Date(),
    });
    await updateCustomer(tx, id, write);
    // Auditoria registra apenas QUAIS campos foram apagados, nunca os valores.
    await recordAudit(tx, actor, actor.organizationId, {
      action: 'customer.anonymized',
      entityType: 'customer',
      entityId: id,
      before: { status: current.status },
      after: { status: 'inactive', fields_cleared: PERSONAL_FIELDS },
      metadata: { reason },
    });
    return { anonymized: true };
  });
}

// -----------------------------------------------------------------------------
// Portal do cliente
// -----------------------------------------------------------------------------

async function ownCustomerId(tx: Tx): Promise<string> {
  const [row] = await tx<{ ids: string[] }[]>`select app.current_customer_ids() as ids`;
  const id = row?.ids[0];
  if (!id) throw new NotFoundError('Cadastro de cliente não encontrado para este usuário.');
  return id;
}

export async function getOwnCustomer(actor: UserActor) {
  authorize(actor, 'portal.access');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const c = await findCustomerById(tx, await ownCustomerId(tx));
    if (!c) throw new NotFoundError('Cadastro de cliente não encontrado para este usuário.');
    return toCustomerDto(c);
  });
}

export async function updateOwnCustomer(actor: UserActor, patch: PortalCustomerUpdate) {
  authorize(actor, 'portal.access');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const current = await loadForUpdate(tx, await ownCustomerId(tx));
    return applyPatch(tx, actor, current, patch as Record<string, unknown>, 'customer.updated_by_customer', 'PORTAL');
  });
}
