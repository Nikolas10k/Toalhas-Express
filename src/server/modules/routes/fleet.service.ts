import 'server-only';
import { z } from 'zod';
import { isValidCpf, normalizeDocument } from '@/lib/br/documents';
import { normalizePhone } from '@/lib/br/phone';
import { normalizePlate } from '@/lib/br/plate';
import { toDbContext, type UserActor } from '@/server/auth/actor';
import { authorize } from '@/server/authz/authorize';
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '@/server/core/errors';
import type { Tx } from '@/server/db/client';
import { isUniqueViolation, withActorTransaction } from '@/server/db/transaction';
import { recordAudit } from '@/server/modules/audit/audit.service';

// -----------------------------------------------------------------------------
// Veículos
// -----------------------------------------------------------------------------

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => v || null);

export const vehicleSchema = z.strictObject({
  plate: z.string().trim().min(7).max(8),
  model: z.string().trim().min(2).max(100),
  capacity: z.number().int().min(1).max(100000),
  status: z.enum(['ACTIVE', 'INACTIVE', 'MAINTENANCE']).default('ACTIVE'),
  notes: optionalText(1000),
});
export const vehicleUpdateSchema = vehicleSchema.partial().strict();

interface VehicleRow {
  id: string;
  plate: string;
  model: string;
  capacity: number;
  status: string;
  notes: string | null;
}

function plateOrThrow(value: string): string {
  const plate = normalizePlate(value);
  if (!plate) throw new ValidationError('Placa inválida.', [{ path: 'plate', message: 'use AAA-9999 ou AAA9A99' }]);
  return plate;
}

export async function listVehicles(actor: UserActor, includeInactive = true) {
  if (!actor.permissions.has('vehicle.manage')) authorize(actor, 'route.read');
  return withActorTransaction(toDbContext(actor), (tx) =>
    tx<VehicleRow[]>`
      select id, plate, model, capacity, status, notes from public.vehicles
       where organization_id = app.current_org_id() ${includeInactive ? tx`` : tx`and status = 'ACTIVE'`}
       order by status = 'ACTIVE' desc, plate`,
  );
}

export async function createVehicle(actor: UserActor, input: z.infer<typeof vehicleSchema>) {
  authorize(actor, 'vehicle.manage');
  const plate = plateOrThrow(input.plate);
  try {
    return await withActorTransaction(toDbContext(actor), async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into public.vehicles (organization_id, plate, model, capacity, status, notes, created_by)
        values (${actor.organizationId}, ${plate}, ${input.model}, ${input.capacity}, ${input.status}, ${input.notes}, ${actor.userId})
        returning id`;
      await recordAudit(tx, actor, actor.organizationId, { action: 'vehicle.created', entityType: 'vehicle', entityId: row!.id, after: { ...input, plate } });
      return { id: row!.id };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError('Já existe um veículo com esta placa.');
    throw err;
  }
}

export async function updateVehicle(actor: UserActor, id: string, patch: z.infer<typeof vehicleUpdateSchema>) {
  authorize(actor, 'vehicle.manage');
  const next = { ...patch, ...(patch.plate !== undefined ? { plate: plateOrThrow(patch.plate) } : {}) };
  try {
    return await withActorTransaction(toDbContext(actor), async (tx) => {
      const [before] = await tx<VehicleRow[]>`
        select id, plate, model, capacity, status, notes from public.vehicles where id = ${id} and organization_id = app.current_org_id() for update`;
      if (!before) throw new NotFoundError('Veículo não encontrado.');
      if (next.status && next.status !== 'ACTIVE' && next.status !== before.status) {
        const [open] = await tx`select 1 from public.routes where vehicle_id = ${id} and status in ('PLANNED', 'IN_PROGRESS') limit 1`;
        if (open) throw new BusinessRuleError('Veículo está em rota aberta. Troque o veículo da rota antes de desativá-lo.');
      }
      await tx`
        update public.vehicles set
          plate = coalesce(${next.plate ?? null}, plate),
          model = coalesce(${next.model ?? null}, model),
          capacity = coalesce(${next.capacity ?? null}::int, capacity),
          status = coalesce(${next.status ?? null}, status),
          notes = case when ${next.notes !== undefined} then ${next.notes ?? null} else notes end
        where id = ${id}`;
      await recordAudit(tx, actor, actor.organizationId, { action: 'vehicle.updated', entityType: 'vehicle', entityId: id, before, after: next });
      return { id };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError('Já existe um veículo com esta placa.');
    throw err;
  }
}

// -----------------------------------------------------------------------------
// Motoristas
// -----------------------------------------------------------------------------

export const driverSchema = z.strictObject({
  fullName: z.string().trim().min(2).max(150),
  document: optionalText(20),
  phone: optionalText(30),
  userId: z.uuid().nullable().optional(),
  defaultVehicleId: z.uuid().nullable().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ON_LEAVE']).default('ACTIVE'),
  notes: optionalText(1000),
});
export const driverUpdateSchema = driverSchema.partial().strict();

interface DriverRow {
  id: string;
  full_name: string;
  document: string | null;
  phone: string | null;
  user_id: string | null;
  user_name: string | null;
  default_vehicle_id: string | null;
  default_vehicle_plate: string | null;
  status: string;
  notes: string | null;
}

function driverDto(d: DriverRow) {
  return {
    id: d.id,
    fullName: d.full_name,
    document: d.document,
    phone: d.phone,
    userId: d.user_id,
    userName: d.user_name,
    defaultVehicleId: d.default_vehicle_id,
    defaultVehiclePlate: d.default_vehicle_plate,
    status: d.status,
    notes: d.notes,
  };
}

function normalizeDriverFields(input: { document?: string | null; phone?: string | null }) {
  const out: { document?: string | null; phone?: string | null } = {};
  if (input.document !== undefined) {
    const doc = input.document ? normalizeDocument(input.document) : null;
    if (doc && !isValidCpf(doc)) throw new ValidationError('CPF inválido.', [{ path: 'document', message: 'inválido' }]);
    out.document = doc;
  }
  if (input.phone !== undefined) {
    const phone = input.phone ? normalizePhone(input.phone) : null;
    if (input.phone && !phone) throw new ValidationError('Telefone inválido.', [{ path: 'phone', message: 'inválido' }]);
    out.phone = phone;
  }
  return out;
}

/** Usuário vinculado precisa ser membro ativo da org com acesso ao app do motorista. */
async function assertDriverUser(tx: Tx, userId: string) {
  const [ok] = await tx`
    select 1
      from public.organization_members m
      join public.member_roles mr on mr.member_id = m.id
      join public.role_permissions rp on rp.role_id = mr.role_id
     where m.organization_id = app.current_org_id() and m.user_id = ${userId} and m.status = 'active'
       and rp.permission_code = 'driver_app.access'
     limit 1`;
  if (!ok) throw new BusinessRuleError('O usuário precisa ser membro ativo com o perfil Motorista.');
}

async function assertVehicle(tx: Tx, vehicleId: string) {
  const [v] = await tx`select 1 from public.vehicles where id = ${vehicleId} and organization_id = app.current_org_id()`;
  if (!v) throw new NotFoundError('Veículo não encontrado.');
}

const DRIVER_SELECT = (tx: Tx) => tx`
  select d.id, d.full_name, d.document, d.phone, d.user_id, p.full_name as user_name, d.default_vehicle_id,
         v.plate as default_vehicle_plate, d.status, d.notes
    from public.drivers d
    left join public.profiles p on p.id = d.user_id
    left join public.vehicles v on v.id = d.default_vehicle_id`;

export async function listDrivers(actor: UserActor) {
  if (!actor.permissions.has('driver.manage')) authorize(actor, 'route.read');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const rows = await tx<DriverRow[]>`${DRIVER_SELECT(tx)} where d.organization_id = app.current_org_id() order by d.status = 'ACTIVE' desc, d.full_name`;
    return rows.map(driverDto);
  });
}

function driverConflict(err: unknown): never {
  if (isUniqueViolation(err, 'drivers_org_document_uidx')) throw new ConflictError('Já existe um motorista com este CPF.');
  if (isUniqueViolation(err, 'drivers_org_user_uidx')) throw new ConflictError('Este usuário já está vinculado a outro motorista.');
  throw err;
}

export async function createDriver(actor: UserActor, input: z.infer<typeof driverSchema>) {
  authorize(actor, 'driver.manage');
  const fields = normalizeDriverFields(input);
  try {
    return await withActorTransaction(toDbContext(actor), async (tx) => {
      if (input.userId) await assertDriverUser(tx, input.userId);
      if (input.defaultVehicleId) await assertVehicle(tx, input.defaultVehicleId);
      const [row] = await tx<{ id: string }[]>`
        insert into public.drivers (organization_id, full_name, document, phone, user_id, default_vehicle_id, status, notes, created_by)
        values (${actor.organizationId}, ${input.fullName}, ${fields.document ?? null}, ${fields.phone ?? null}, ${input.userId ?? null},
                ${input.defaultVehicleId ?? null}, ${input.status}, ${input.notes}, ${actor.userId})
        returning id`;
      await recordAudit(tx, actor, actor.organizationId, {
        action: 'driver.created',
        entityType: 'driver',
        entityId: row!.id,
        after: { ...input, ...fields },
      });
      return { id: row!.id };
    });
  } catch (err) {
    driverConflict(err);
  }
}

export async function updateDriver(actor: UserActor, id: string, patch: z.infer<typeof driverUpdateSchema>) {
  authorize(actor, 'driver.manage');
  const fields = normalizeDriverFields(patch);
  const next = { ...patch, ...fields };
  try {
    return await withActorTransaction(toDbContext(actor), async (tx) => {
      const [before] = await tx<DriverRow[]>`${DRIVER_SELECT(tx)} where d.id = ${id} and d.organization_id = app.current_org_id() for update of d`;
      if (!before) throw new NotFoundError('Motorista não encontrado.');
      if (next.userId) await assertDriverUser(tx, next.userId);
      if (next.defaultVehicleId) await assertVehicle(tx, next.defaultVehicleId);
      if (next.status && next.status !== 'ACTIVE' && before.status === 'ACTIVE') {
        const [open] = await tx`select 1 from public.routes where driver_id = ${id} and status in ('PLANNED', 'IN_PROGRESS') limit 1`;
        if (open) throw new BusinessRuleError('Motorista tem rota aberta. Troque o motorista da rota antes de alterar o status.');
      }
      const has = (k: keyof typeof next) => next[k] !== undefined;
      await tx`
        update public.drivers set
          full_name = coalesce(${next.fullName ?? null}, full_name),
          document = case when ${has('document')} then ${next.document ?? null} else document end,
          phone = case when ${has('phone')} then ${next.phone ?? null} else phone end,
          user_id = case when ${has('userId')} then ${next.userId ?? null}::uuid else user_id end,
          default_vehicle_id = case when ${has('defaultVehicleId')} then ${next.defaultVehicleId ?? null}::uuid else default_vehicle_id end,
          status = coalesce(${next.status ?? null}, status),
          notes = case when ${has('notes')} then ${next.notes ?? null} else notes end
        where id = ${id}`;
      await recordAudit(tx, actor, actor.organizationId, { action: 'driver.updated', entityType: 'driver', entityId: id, before: driverDto(before), after: next });
      return { id };
    });
  } catch (err) {
    driverConflict(err);
  }
}

/** Membros da org com perfil de motorista ainda sem cadastro (para vincular). */
export async function listDriverUserCandidates(actor: UserActor) {
  authorize(actor, 'driver.manage');
  authorize(actor, 'users.read');
  return withActorTransaction(toDbContext(actor), (tx) =>
    tx<{ userId: string; fullName: string | null }[]>`
      select distinct p.id as "userId", p.full_name as "fullName"
        from public.organization_members m
        join public.profiles p on p.id = m.user_id
        join public.member_roles mr on mr.member_id = m.id
        join public.role_permissions rp on rp.role_id = mr.role_id
       where m.organization_id = app.current_org_id() and m.status = 'active' and rp.permission_code = 'driver_app.access'
         and not exists (select 1 from public.drivers d where d.organization_id = m.organization_id and d.user_id = m.user_id)
       order by 2`,
  );
}
