import 'server-only';
import { z } from 'zod';
import { toDbContext, type UserActor } from '@/server/auth/actor';
import { authorize } from '@/server/authz/authorize';
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '@/server/core/errors';
import { logger } from '@/server/core/logger';
import type { Tx } from '@/server/db/client';
import { isUniqueViolation, withActorTransaction, withSystemTransaction } from '@/server/db/transaction';
import { recordAudit } from '@/server/modules/audit/audit.service';
import { executeIdempotent } from '@/server/modules/idempotency/idempotency.service';
import type { JobHandler } from '@/server/modules/jobs/jobs.service';
import { todayInSaoPaulo } from '@/server/modules/orders/orders.domain';
import { recordOutboxEvent } from '@/server/modules/outbox/outbox.service';
import {
  assertTermsConsistent,
  BILLING_TYPES,
  computeMonthBilling,
  CONTRACT_STATUSES,
  contractStateMachine,
  formatContractNumber,
  monthBounds,
  renewedEnd,
  type BillingType,
  type ContractStatus,
  type ContractTerms,
  type MonthUsage,
} from './contracts.domain';

export const RENEWAL_JOB = 'contracts.renewal';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.');
const cents = z.number().int().min(0).max(100_000_000_00);

export const contractItemSchema = z.strictObject({
  productId: z.uuid(),
  contractedQuantity: z.number().int().min(0).max(1_000_000).default(0),
  franchiseQuantity: z.number().int().min(0).max(1_000_000).default(0),
  unitPriceCents: cents.default(0),
  excessPriceCents: cents.default(0),
  lossPriceCents: cents.nullable().optional().transform((v) => v ?? null),
  damagePriceCents: cents.nullable().optional().transform((v) => v ?? null),
});

const termsFields = {
  billingType: z.enum(BILLING_TYPES),
  startsOn: isoDate,
  endsOn: isoDate.nullable().optional().transform((v) => v || null),
  renewal: z.enum(['AUTO', 'MANUAL', 'NONE']).default('MANUAL'),
  renewalMonths: z.number().int().min(1).max(60).default(12),
  dueDay: z.number().int().min(1).max(28),
  monthlyFeeCents: cents.default(0),
  perDeliveryFeeCents: cents.default(0),
  discountBp: z.number().int().min(0).max(10_000).default(0),
  prorateFirstMonth: z.boolean().default(true),
  customTerms: z.string().trim().max(4000).nullable().optional().transform((v) => v || null),
  notes: z.string().trim().max(2000).nullable().optional().transform((v) => v || null),
  items: z.array(contractItemSchema).max(30).default([]),
};

export const createContractSchema = z.strictObject({ customerId: z.uuid(), ...termsFields });
export const updateContractSchema = z.strictObject({ ...termsFields, reason: z.string().trim().max(500).nullable().optional().transform((v) => v || null) });
export type ContractInput = z.infer<typeof createContractSchema>;

interface ContractRow {
  id: string;
  number: string;
  customer_id: string;
  customer_name: string | null;
  customer_status: string;
  status: ContractStatus;
  billing_type: BillingType;
  starts_on: string;
  ends_on: string | null;
  renewal: 'AUTO' | 'MANUAL' | 'NONE';
  renewal_months: number;
  due_day: number;
  monthly_fee_cents: string;
  per_delivery_fee_cents: string;
  discount_bp: number;
  prorate_first_month: boolean;
  custom_terms: string | null;
  notes: string | null;
  status_reason: string | null;
  activated_at: Date | null;
  ended_at: Date | null;
  revision: number;
  created_at: Date;
}

const CONTRACT_SELECT = `
  c.id, c.number::text as number, c.customer_id, coalesce(cu.trade_name, cu.legal_name) as customer_name, cu.status as customer_status,
  c.status, c.billing_type, c.starts_on::text as starts_on, c.ends_on::text as ends_on, c.renewal, c.renewal_months, c.due_day,
  c.monthly_fee_cents::text as monthly_fee_cents, c.per_delivery_fee_cents::text as per_delivery_fee_cents, c.discount_bp,
  c.prorate_first_month, c.custom_terms, c.notes, c.status_reason, c.activated_at, c.ended_at, c.revision, c.created_at
`;

async function findContract(tx: Tx, id: string, forUpdate = false): Promise<ContractRow | null> {
  if (forUpdate) await tx`select 1 from public.contracts where id = ${id} and organization_id = app.current_org_id() for update`;
  const [row] = await tx.unsafe<ContractRow[]>(
    `select ${CONTRACT_SELECT} from public.contracts c join public.customers cu on cu.id = c.customer_id
      where c.id = $1 and c.organization_id = app.current_org_id()`,
    [id],
  );
  return row ?? null;
}

interface ItemRow {
  product_id: string;
  product_name: string;
  replacement_price_cents: string;
  contracted_quantity: number;
  franchise_quantity: number;
  unit_price_cents: string;
  excess_price_cents: string;
  loss_price_cents: string | null;
  damage_price_cents: string | null;
}

async function contractItems(tx: Tx, id: string): Promise<ItemRow[]> {
  return tx<ItemRow[]>`
    select ci.product_id, p.name as product_name, p.replacement_price_cents::text as replacement_price_cents, ci.contracted_quantity,
           ci.franchise_quantity, ci.unit_price_cents::text as unit_price_cents, ci.excess_price_cents::text as excess_price_cents,
           ci.loss_price_cents::text as loss_price_cents, ci.damage_price_cents::text as damage_price_cents
      from public.contract_items ci join public.products p on p.id = ci.product_id
     where ci.contract_id = ${id} order by p.name`;
}

const num = (v: string | null) => (v === null ? null : Number(v));

function toTerms(c: ContractRow, items: ItemRow[]): ContractTerms {
  return {
    billingType: c.billing_type,
    startsOn: c.starts_on,
    endsOn: c.ends_on,
    dueDay: c.due_day,
    monthlyFeeCents: Number(c.monthly_fee_cents),
    perDeliveryFeeCents: Number(c.per_delivery_fee_cents),
    discountBp: c.discount_bp,
    prorateFirstMonth: c.prorate_first_month,
    items: items.map((i) => ({
      productId: i.product_id,
      productName: i.product_name,
      contractedQuantity: i.contracted_quantity,
      franchiseQuantity: i.franchise_quantity,
      unitPriceCents: Number(i.unit_price_cents),
      excessPriceCents: Number(i.excess_price_cents),
      lossPriceCents: num(i.loss_price_cents),
      damagePriceCents: num(i.damage_price_cents),
    })),
  };
}

function contractDto(c: ContractRow) {
  return {
    id: c.id,
    number: formatContractNumber(c.number),
    customerId: c.customer_id,
    customerName: c.customer_name,
    status: c.status,
    billingType: c.billing_type,
    startsOn: c.starts_on,
    endsOn: c.ends_on,
    renewal: c.renewal,
    renewalMonths: c.renewal_months,
    dueDay: c.due_day,
    monthlyFeeCents: Number(c.monthly_fee_cents),
    perDeliveryFeeCents: Number(c.per_delivery_fee_cents),
    discountBp: c.discount_bp,
    prorateFirstMonth: c.prorate_first_month,
    customTerms: c.custom_terms,
    notes: c.notes,
    statusReason: c.status_reason,
    activatedAt: c.activated_at?.toISOString() ?? null,
    endedAt: c.ended_at?.toISOString() ?? null,
    revision: c.revision,
    createdAt: c.created_at.toISOString(),
  };
}

async function snapshot(tx: Tx, id: string) {
  const c = (await findContract(tx, id))!;
  const items = await contractItems(tx, id);
  return { ...contractDto(c), items: toTerms(c, items).items };
}

async function writeRevision(tx: Tx, actor: UserActor, id: string, revision: number, changeType: string, reason: string | null) {
  await tx`
    insert into public.contract_revisions (organization_id, contract_id, revision, change_type, reason, snapshot, actor_type, actor_id, created_at)
    values (${actor.organizationId}, ${id}, ${revision}, ${changeType}, ${reason}, ${tx.json((await snapshot(tx, id)) as never)}, 'USER', ${actor.userId}, clock_timestamp())`;
}

async function validateInput(tx: Tx, input: Omit<ContractInput, 'customerId'>) {
  if (input.endsOn && input.endsOn < input.startsOn) throw new ValidationError('O fim da vigência é anterior ao início.', [{ path: 'endsOn', message: 'inválido' }]);
  if (input.renewal === 'AUTO' && !input.endsOn) throw new ValidationError('Renovação automática precisa de data de fim.', [{ path: 'endsOn', message: 'obrigatório' }]);
  const ids = input.items.map((i) => i.productId);
  const found = ids.length
    ? await tx<{ id: string; name: string }[]>`select id, name from public.products where organization_id = app.current_org_id() and id = any (${ids}::uuid[])`
    : [];
  if (found.length !== new Set(ids).size) throw new NotFoundError('Produto não encontrado.');
  const names = new Map(found.map((p) => [p.id, p.name]));
  assertTermsConsistent({ ...input, items: input.items.map((i) => ({ ...i, productName: names.get(i.productId) ?? '' })) });
}

async function writeTerms(tx: Tx, actor: UserActor, id: string, input: Omit<ContractInput, 'customerId'>) {
  await tx`
    update public.contracts set
      billing_type = ${input.billingType}, starts_on = ${input.startsOn}, ends_on = ${input.endsOn}, renewal = ${input.renewal},
      renewal_months = ${input.renewalMonths}, due_day = ${input.dueDay}, monthly_fee_cents = ${input.monthlyFeeCents},
      per_delivery_fee_cents = ${input.perDeliveryFeeCents}, discount_bp = ${input.discountBp}, prorate_first_month = ${input.prorateFirstMonth},
      custom_terms = ${input.customTerms}, notes = ${input.notes}
    where id = ${id}`;
  await tx`delete from public.contract_items where contract_id = ${id}`;
  for (const i of input.items) {
    await tx`
      insert into public.contract_items (organization_id, contract_id, product_id, contracted_quantity, franchise_quantity, unit_price_cents,
                                         excess_price_cents, loss_price_cents, damage_price_cents)
      values (${actor.organizationId}, ${id}, ${i.productId}, ${i.contractedQuantity}, ${i.franchiseQuantity}, ${i.unitPriceCents},
              ${i.excessPriceCents}, ${i.lossPriceCents}, ${i.damagePriceCents})`;
  }
}

// -----------------------------------------------------------------------------
// Comandos
// -----------------------------------------------------------------------------

export async function createContract(actor: UserActor, input: ContractInput, idempotencyKey?: string) {
  authorize(actor, 'contract.manage');
  const run = async (tx: Tx) => {
    const [cu] = await tx<{ id: string }[]>`select id from public.customers where id = ${input.customerId} and organization_id = app.current_org_id() and anonymized_at is null`;
    if (!cu) throw new NotFoundError('Cliente não encontrado.');
    await validateInput(tx, input);
    const [{ n }] = (await tx`select app.next_contract_number(${actor.organizationId}) as n`) as unknown as [{ n: string }];
    const [row] = await tx<{ id: string }[]>`
      insert into public.contracts (organization_id, number, customer_id, billing_type, starts_on, due_day, created_by)
      values (${actor.organizationId}, ${n}, ${input.customerId}, ${input.billingType}, ${input.startsOn}, ${input.dueDay}, ${actor.userId})
      returning id`;
    const id = row!.id;
    await writeTerms(tx, actor, id, input);
    await writeRevision(tx, actor, id, 1, 'CREATED', null);
    await recordAudit(tx, actor, actor.organizationId, { action: 'contract.created', entityType: 'contract', entityId: id, after: input });
    return { id, number: formatContractNumber(n) };
  };
  if (idempotencyKey) return (await executeIdempotent(actor, { scope: 'contract.create', key: idempotencyKey, request: input }, run)).result;
  return withActorTransaction(toDbContext(actor), run);
}

/** Alteração de termos: sempre auditada e com revisão; contrato vigente exige motivo. */
export async function updateContract(actor: UserActor, id: string, input: z.infer<typeof updateContractSchema>) {
  authorize(actor, 'contract.manage');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const c = await findContract(tx, id, true);
    if (!c) throw new NotFoundError('Contrato não encontrado.');
    if (c.status === 'ENDED' || c.status === 'CANCELLED') throw new BusinessRuleError('Contrato encerrado ou cancelado não pode ser alterado.');
    if (c.status !== 'DRAFT' && (!input.reason || input.reason.length < 5)) {
      throw new ValidationError('Informe o motivo da alteração de um contrato vigente.', [{ path: 'reason', message: 'obrigatório' }]);
    }
    await validateInput(tx, input);
    const before = await snapshot(tx, id);
    await writeTerms(tx, actor, id, input);
    const revision = c.revision + 1;
    await tx`update public.contracts set revision = ${revision} where id = ${id}`;
    await writeRevision(tx, actor, id, revision, 'UPDATED', input.reason);
    await recordAudit(tx, actor, actor.organizationId, { action: 'contract.updated', entityType: 'contract', entityId: id, before, after: await snapshot(tx, id), metadata: { reason: input.reason } });
    return { id, revision };
  });
}

export const contractTransitionSchema = z.strictObject({
  to: z.enum(['ACTIVE', 'SUSPENDED', 'ENDED', 'CANCELLED']),
  reason: z.string().trim().max(500).nullable().optional().transform((v) => v || null),
});

export async function transitionContract(actor: UserActor, id: string, input: z.infer<typeof contractTransitionSchema>) {
  authorize(actor, 'contract.manage');
  if (input.to !== 'ACTIVE' && (!input.reason || input.reason.length < 3)) throw new ValidationError('Informe o motivo.', [{ path: 'reason', message: 'obrigatório' }]);
  try {
    return await withActorTransaction(toDbContext(actor), async (tx) => {
      const c = await findContract(tx, id, true);
      if (!c) throw new NotFoundError('Contrato não encontrado.');
      contractStateMachine.assertTransition(c.status, input.to);
      if (input.to === 'ACTIVE') {
        if (c.customer_status !== 'active') throw new BusinessRuleError('Ative o cadastro do cliente antes de ativar o contrato.');
        assertTermsConsistent(toTerms(c, await contractItems(tx, id)));
        if (c.ends_on && c.ends_on < todayInSaoPaulo()) throw new BusinessRuleError('A vigência deste contrato já terminou.');
      }
      const endsOn = input.to === 'ENDED' && (!c.ends_on || c.ends_on > todayInSaoPaulo()) ? todayInSaoPaulo() : c.ends_on;
      const revision = c.revision + 1;
      await tx`
        update public.contracts
           set status = ${input.to}, status_reason = ${input.reason}, revision = ${revision}, ends_on = ${endsOn},
               activated_at = case when ${input.to} = 'ACTIVE' and activated_at is null then now() else activated_at end,
               ended_at = case when ${input.to} in ('ENDED', 'CANCELLED') then now() else ended_at end
         where id = ${id}`;
      await writeRevision(tx, actor, id, revision, `STATUS_${input.to}`, input.reason);
      await recordAudit(tx, actor, actor.organizationId, { action: 'contract.status_changed', entityType: 'contract', entityId: id, before: { status: c.status }, after: { status: input.to }, metadata: { reason: input.reason } });
      if (input.to === 'ACTIVE' || input.to === 'ENDED') {
        await recordOutboxEvent(tx, {
          organizationId: actor.organizationId,
          eventType: input.to === 'ACTIVE' ? 'ContractActivated' : 'ContractEnded',
          aggregateType: 'contract',
          aggregateId: id,
          payload: { contract_id: id, customer_id: c.customer_id, number: c.number, billing_type: c.billing_type },
          idempotencyKey: `Contract${input.to}:${id}:${revision}`,
        });
      }
      return { status: input.to, revision };
    });
  } catch (err) {
    if (isUniqueViolation(err, 'contracts_customer_current_uidx')) throw new ConflictError('Este cliente já tem um contrato vigente. Encerre-o antes de ativar outro.');
    throw err;
  }
}

// -----------------------------------------------------------------------------
// Consultas
// -----------------------------------------------------------------------------

export const contractListQuerySchema = z.strictObject({
  status: z.enum(CONTRACT_STATUSES).optional(),
  customerId: z.uuid().optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
});

export async function listContracts(actor: UserActor, q: z.infer<typeof contractListQuerySchema>) {
  authorize(actor, 'contract.read');
  const pageSize = 30;
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const like = q.search ? `%${q.search.toLowerCase().replace(/[\\%_]/g, (ch) => `\\${ch}`)}%` : null;
    const rows = await tx.unsafe<ContractRow[]>(
      `select ${CONTRACT_SELECT} from public.contracts c join public.customers cu on cu.id = c.customer_id
        where c.organization_id = app.current_org_id()
          and ($1::text is null or c.status = $1) and ($2::uuid is null or c.customer_id = $2)
          and ($3::text is null or lower(coalesce(cu.trade_name, '')) like $3 or lower(cu.legal_name) like $3)
        order by c.status in ('ACTIVE', 'SUSPENDED', 'DRAFT') desc, c.created_at desc
        limit $4 offset $5`,
      [q.status ?? null, q.customerId ?? null, like, pageSize + 1, (q.page - 1) * pageSize],
    );
    return { items: rows.slice(0, pageSize).map(contractDto), hasMore: rows.length > pageSize };
  });
}

/** Uso real do cliente no mês (entregas atendidas e toalhas entregues por produto). */
async function monthUsage(tx: Tx, customerId: string, month: string): Promise<MonthUsage> {
  const { from, to } = monthBounds(month);
  const [d] = await tx<{ n: number }[]>`
    select count(distinct op.id)::int as n
      from public.stop_operations op join public.stop_operation_items it on it.operation_id = op.id
     where op.customer_id = ${customerId} and it.delivered > 0
       and (op.occurred_at at time zone 'America/Sao_Paulo')::date between ${from}::date and ${to}::date`;
  const rows = await tx<{ product_id: string; q: number }[]>`
    select product_id, sum(quantity)::int as q from public.towel_movements
     where customer_id = ${customerId} and movement_type = 'DELIVERY' and to_state = 'WITH_CUSTOMER'
       and (occurred_at at time zone 'America/Sao_Paulo')::date between ${from}::date and ${to}::date
     group by product_id`;
  return { deliveries: d?.n ?? 0, deliveredByProduct: Object.fromEntries(rows.map((r) => [r.product_id, r.q])) };
}

export async function getContractDetail(actor: UserActor, id: string) {
  authorize(actor, 'contract.read');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const c = await findContract(tx, id);
    if (!c) throw new NotFoundError('Contrato não encontrado.');
    const items = await contractItems(tx, id);
    const revisions = await tx<{ id: string; revision: number; change_type: string; reason: string | null; actor_name: string | null; created_at: Date }[]>`
      select r.id, r.revision, r.change_type, r.reason, p.full_name as actor_name, r.created_at
        from public.contract_revisions r left join public.profiles p on p.id = r.actor_id and r.actor_type = 'USER'
       where r.contract_id = ${id} order by r.created_at desc, r.id`;
    const manage = actor.permissions.has('contract.manage');
    return {
      contract: contractDto(c),
      items: items.map((i) => ({
        productId: i.product_id,
        productName: i.product_name,
        replacementPriceCents: Number(i.replacement_price_cents),
        contractedQuantity: i.contracted_quantity,
        franchiseQuantity: i.franchise_quantity,
        unitPriceCents: Number(i.unit_price_cents),
        excessPriceCents: Number(i.excess_price_cents),
        lossPriceCents: num(i.loss_price_cents),
        damagePriceCents: num(i.damage_price_cents),
      })),
      revisions: revisions.map((r) => ({ id: r.id, revision: r.revision, changeType: r.change_type, reason: r.reason, actorName: r.actor_name, at: r.created_at.toISOString() })),
      actions: {
        edit: manage && ['DRAFT', 'ACTIVE', 'SUSPENDED'].includes(c.status),
        transitions: manage ? contractStateMachine.allowedFrom(c.status) : [],
      },
    };
  });
}

/** Simulação do mês com o uso real (mesma função que o financeiro usará para faturar). */
export async function simulateContractBilling(actor: UserActor, id: string, month: string) {
  authorize(actor, 'contract.read');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ValidationError('Mês inválido (AAAA-MM).');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const c = await findContract(tx, id);
    if (!c) throw new NotFoundError('Contrato não encontrado.');
    const usage = await monthUsage(tx, c.customer_id, month);
    return { usage, billing: computeMonthBilling(toTerms(c, await contractItems(tx, id)), month, usage) };
  });
}

/** Portal: contrato vigente do próprio cliente (sem notas internas). */
export async function getOwnContract(actor: UserActor) {
  authorize(actor, 'portal.access');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      select id from public.contracts where status in ('ACTIVE', 'SUSPENDED') and customer_id = any (app.current_customer_ids()) limit 1`;
    if (!row) return null;
    const c = (await findContract(tx, row.id))!;
    const items = await contractItems(tx, row.id);
    const { notes: _notes, statusReason: _reason, ...dto } = contractDto(c);
    return { contract: dto, items: toTerms(c, items).items };
  });
}

// -----------------------------------------------------------------------------
// Renovação (job diário)
// -----------------------------------------------------------------------------

/** Vigência vencida: renovação automática estende; senão o contrato é encerrado. Idempotente. */
export async function processRenewals(organizationId: string, today = todayInSaoPaulo()) {
  const due = await withSystemTransaction(
    (tx) => tx<{ id: string }[]>`
      select id from public.contracts where organization_id = ${organizationId} and status in ('ACTIVE', 'SUSPENDED') and ends_on < ${today}::date`,
  );
  let renewed = 0;
  let ended = 0;
  for (const { id } of due) {
    await withSystemTransaction(async (tx) => {
      await tx`select set_config('app.org_id', ${organizationId}, true)`;
      const [c] = await tx<{ status: string; ends_on: string; renewal: string; renewal_months: number; revision: number; customer_id: string }[]>`
        select status, ends_on::text as ends_on, renewal, renewal_months, revision, customer_id from public.contracts where id = ${id} for update`;
      if (!c || !['ACTIVE', 'SUSPENDED'].includes(c.status) || c.ends_on >= today) return;
      const revision = c.revision + 1;
      if (c.renewal === 'AUTO') {
        let end = c.ends_on;
        while (end < today) end = renewedEnd(end, c.renewal_months);
        await tx`update public.contracts set ends_on = ${end}, revision = ${revision} where id = ${id}`;
        await tx`
          insert into public.contract_revisions (organization_id, contract_id, revision, change_type, reason, snapshot, actor_type, created_at)
          values (${organizationId}, ${id}, ${revision}, 'RENEWED', ${`Renovação automática até ${end}`}, ${tx.json({ ends_on: end, previous_ends_on: c.ends_on })}, 'SYSTEM', clock_timestamp())`;
        await recordAudit(tx, { type: 'SYSTEM', reason: 'contract_renewal' }, organizationId, { action: 'contract.renewed', entityType: 'contract', entityId: id, before: { ends_on: c.ends_on }, after: { ends_on: end } });
        renewed += 1;
      } else {
        await tx`update public.contracts set status = 'ENDED', ended_at = now(), revision = ${revision}, status_reason = 'Fim da vigência' where id = ${id}`;
        await tx`
          insert into public.contract_revisions (organization_id, contract_id, revision, change_type, reason, snapshot, actor_type, created_at)
          values (${organizationId}, ${id}, ${revision}, 'STATUS_ENDED', 'Fim da vigência', ${tx.json({ ends_on: c.ends_on })}, 'SYSTEM', clock_timestamp())`;
        await recordAudit(tx, { type: 'SYSTEM', reason: 'contract_renewal' }, organizationId, { action: 'contract.ended', entityType: 'contract', entityId: id, before: { status: c.status }, after: { status: 'ENDED' } });
        await recordOutboxEvent(tx, {
          organizationId, eventType: 'ContractEnded', aggregateType: 'contract', aggregateId: id,
          payload: { contract_id: id, customer_id: c.customer_id, reason: 'END_OF_TERM' }, idempotencyKey: `ContractENDED:${id}:${revision}`,
        });
        ended += 1;
      }
    });
  }
  return { renewed, ended };
}

export const renewalHandler: JobHandler = async () => {
  const orgs = await withSystemTransaction((tx) => tx<{ id: string }[]>`select id from public.organizations where status = 'active' and deleted_at is null`);
  for (const o of orgs) {
    const r = await processRenewals(o.id);
    if (r.renewed || r.ended) logger.info('contracts.renewals', { organization_id: o.id, ...r });
  }
};
