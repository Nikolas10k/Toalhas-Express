import 'server-only';
import { z } from 'zod';
import { toDbContext, type UserActor } from '@/server/auth/actor';
import { authorize, hasPermission } from '@/server/authz/authorize';
import { AuthorizationError, BusinessRuleError, NotFoundError, ValidationError } from '@/server/core/errors';
import { logger } from '@/server/core/logger';
import { cents, multiplyCents } from '@/server/core/money';
import type { Tx } from '@/server/db/client';
import { withActorTransaction, withSystemTransaction } from '@/server/db/transaction';
import { linkAttachments, listAttachmentIds } from '@/server/modules/attachments/attachments.service';
import { recordAudit } from '@/server/modules/audit/audit.service';
import type { MovementInput } from '@/server/modules/inventory/inventory.domain';
import { recordMovements } from '@/server/modules/inventory/inventory.service';
import { lossDamagePrice } from '@/server/modules/contracts/contracts.domain';
import { formatOrderNumber } from '@/server/modules/orders/orders.domain';
import { recordOutboxEvent } from '@/server/modules/outbox/outbox.service';
import {
  allowedDecisions,
  DAMAGE_CLASSES,
  DECISIONS,
  formatIncidentNumber,
  INCIDENT_STATUSES,
  INCIDENT_TYPES,
  incidentStateMachine,
  type Decision,
  type IncidentStatus,
  type IncidentType,
} from './incidents.domain';

// -----------------------------------------------------------------------------
// Criação (usada pelo atendimento da parada e pela equipe)
// -----------------------------------------------------------------------------

export interface NewIncident {
  type: IncidentType;
  source: 'DRIVER' | 'STAFF' | 'SYSTEM';
  description: string;
  customerId?: string | null;
  orderId?: string | null;
  routeId?: string | null;
  routeStopId?: string | null;
  operationId?: string | null;
  productId?: string | null;
  quantity?: number;
  damageClass?: string | null;
  details?: Record<string, unknown>;
}

async function insertEvent(tx: Tx, actor: UserActor, incidentId: string, type: string, from: string | null, to: string | null, note: string | null, metadata: Record<string, unknown> = {}) {
  await tx`
    insert into public.incident_events (organization_id, incident_id, event_type, from_status, to_status, note, metadata, actor_type, actor_id, created_at)
    values (${actor.organizationId}, ${incidentId}, ${type}, ${from}, ${to}, ${note}, ${tx.json(metadata as never)}, 'USER', ${actor.userId}, clock_timestamp())`;
}

export async function createIncidentRow(tx: Tx, actor: UserActor, i: NewIncident): Promise<{ id: string; number: string }> {
  const [{ n }] = (await tx`select app.next_incident_number(${actor.organizationId}) as n`) as unknown as [{ n: string }];
  const [row] = await tx<{ id: string }[]>`
    insert into public.incidents (organization_id, number, incident_type, source, customer_id, order_id, route_id, route_stop_id, operation_id,
                                  product_id, quantity, description, details, damage_class, reported_by, reporter_type)
    values (${actor.organizationId}, ${n}, ${i.type}, ${i.source}, ${i.customerId ?? null}, ${i.orderId ?? null}, ${i.routeId ?? null},
            ${i.routeStopId ?? null}, ${i.operationId ?? null}, ${i.productId ?? null}, ${i.quantity ?? 0}, ${i.description},
            ${tx.json((i.details ?? {}) as never)}, ${i.damageClass ?? null}, ${actor.userId}, 'USER')
    returning id`;
  const id = row!.id;
  await insertEvent(tx, actor, id, 'CREATED', null, 'OPEN', i.description, { type: i.type, quantity: i.quantity ?? 0 });
  await recordAudit(tx, actor, actor.organizationId, { action: 'incident.created', entityType: 'incident', entityId: id, after: { ...i, number: n } });
  await recordOutboxEvent(tx, {
    organizationId: actor.organizationId,
    eventType: i.type === 'QUANTITY_DIVERGENCE' ? 'QuantityDivergenceDetected' : 'IncidentOpened',
    aggregateType: 'incident',
    aggregateId: id,
    payload: { incident_id: id, number: n, type: i.type, customer_id: i.customerId ?? null, order_id: i.orderId ?? null, quantity: i.quantity ?? 0, details: i.details ?? {} },
    idempotencyKey: `IncidentOpened:${id}`,
  });
  return { id, number: n };
}

/** Alerta operacional (depois do commit; falha aqui nunca desfaz a operação). */
export async function openIncidentAlert(organizationId: string, incident: { id: string; number: string; type: IncidentType; title: string }) {
  await withSystemTransaction(async (tx) => {
    await tx`
      insert into public.system_alerts (organization_id, alert_type, severity, title, details, dedupe_key)
      values (${organizationId}, ${incident.type}, 'WARNING', ${`${formatIncidentNumber(incident.number)}: ${incident.title}`.slice(0, 200)},
              ${tx.json({ incident_id: incident.id })}, ${`INCIDENT:${incident.id}`})
      on conflict (organization_id, dedupe_key) where status <> 'RESOLVED' do nothing`;
  }).catch((e) => logger.error('incident.alert_failed', { error: e, incident_id: incident.id }));
}

async function resolveIncidentAlert(organizationId: string, incidentId: string) {
  await withSystemTransaction(
    (tx) => tx`update public.system_alerts set status = 'RESOLVED', resolved_at = now()
                where organization_id = ${organizationId} and dedupe_key = ${`INCIDENT:${incidentId}`} and status <> 'RESOLVED'`,
  ).catch((e) => logger.error('incident.alert_resolve_failed', { error: e, incident_id: incidentId }));
}

export const reportIncidentSchema = z.strictObject({
  type: z.enum(INCIDENT_TYPES),
  customerId: z.uuid().nullable().optional(),
  orderId: z.uuid().nullable().optional(),
  productId: z.uuid().nullable().optional(),
  quantity: z.number().int().min(0).max(100000).default(0),
  description: z.string().trim().min(3).max(2000),
  damageClass: z.enum(DAMAGE_CLASSES).nullable().optional(),
  attachmentIds: z.array(z.uuid()).max(5).default([]),
});

/** Ocorrência aberta pela equipe (ex.: cliente avisou perda por telefone). */
export async function reportIncident(actor: UserActor, input: z.infer<typeof reportIncidentSchema>) {
  if (!hasPermission(actor, 'incident.report') && !hasPermission(actor, 'incident.manage')) throw new AuthorizationError();
  if (input.quantity > 0 && !input.productId) throw new ValidationError('Informe o produto da quantidade.', [{ path: 'productId', message: 'obrigatório' }]);
  const created = await withActorTransaction(toDbContext(actor), async (tx) => {
    if (input.customerId) {
      const [c] = await tx`select 1 from public.customers where id = ${input.customerId} and organization_id = app.current_org_id()`;
      if (!c) throw new NotFoundError('Cliente não encontrado.');
    }
    if (input.productId) {
      const [p] = await tx`select 1 from public.products where id = ${input.productId} and organization_id = app.current_org_id()`;
      if (!p) throw new NotFoundError('Produto não encontrado.');
    }
    let customerId = input.customerId ?? null;
    if (input.orderId) {
      const [o] = await tx<{ customer_id: string }[]>`select customer_id from public.orders where id = ${input.orderId} and organization_id = app.current_org_id()`;
      if (!o) throw new NotFoundError('Pedido não encontrado.');
      if (customerId && customerId !== o.customer_id) throw new ValidationError('O pedido é de outro cliente.');
      customerId = o.customer_id;
    }
    const inc = await createIncidentRow(tx, actor, {
      type: input.type,
      source: 'STAFF',
      description: input.description,
      customerId,
      orderId: input.orderId ?? null,
      productId: input.productId ?? null,
      quantity: input.quantity,
      damageClass: input.type === 'DAMAGED' ? input.damageClass ?? null : null,
      // Dano registrado pela equipe: toalhas já separadas, aguardando lavagem.
      details: input.type === 'DAMAGED' ? { location: 'AWAITING_LAUNDRY' } : {},
    });
    await linkAttachments(tx, actor, input.attachmentIds, 'incident', inc.id);
    return inc;
  });
  await openIncidentAlert(actor.organizationId, { ...created, type: input.type, title: input.description });
  return created;
}

// -----------------------------------------------------------------------------
// Consultas
// -----------------------------------------------------------------------------

export const incidentListQuerySchema = z.strictObject({
  status: z.enum(INCIDENT_STATUSES).optional(),
  type: z.enum(INCIDENT_TYPES).optional(),
  /** Grupo "perdas e danos" do menu de estoque. */
  group: z.enum(['loss_damage']).optional(),
  customerId: z.uuid().optional(),
  open: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
});

const LOSS_DAMAGE_TYPES = ['DAMAGED', 'LOST', 'NOT_RETURNED', 'QUANTITY_DIVERGENCE'];

interface IncidentRow {
  id: string;
  number: string;
  incident_type: IncidentType;
  status: IncidentStatus;
  source: string;
  customer_id: string | null;
  customer_name: string | null;
  order_id: string | null;
  order_number: string | null;
  route_id: string | null;
  route_stop_id: string | null;
  operation_id: string | null;
  product_id: string | null;
  product_name: string | null;
  product_kind: string | null;
  replacement_price_cents: string | null;
  quantity: number;
  description: string;
  details: Record<string, unknown>;
  damage_class: string | null;
  decision: Decision | null;
  charge_customer: boolean | null;
  charge_amount_cents: string | null;
  assigned_to: string | null;
  assigned_name: string | null;
  reporter_name: string | null;
  resolution: string | null;
  resolved_at: Date | null;
  created_at: Date;
}

const INCIDENT_SELECT = `
  i.id, i.number::text as number, i.incident_type, i.status, i.source, i.customer_id, coalesce(c.trade_name, c.legal_name) as customer_name,
  i.order_id, o.number::text as order_number, i.route_id, i.route_stop_id, i.operation_id, i.product_id, p.name as product_name, p.kind as product_kind,
  p.replacement_price_cents::text as replacement_price_cents, i.quantity, i.description, i.details, i.damage_class, i.decision,
  i.charge_customer, i.charge_amount_cents::text as charge_amount_cents, i.assigned_to, a.full_name as assigned_name,
  r.full_name as reporter_name, i.resolution, i.resolved_at, i.created_at
`;
const INCIDENT_FROM = `
  from public.incidents i
  left join public.customers c on c.id = i.customer_id
  left join public.orders o on o.id = i.order_id
  left join public.products p on p.id = i.product_id
  left join public.profiles a on a.id = i.assigned_to
  left join public.profiles r on r.id = i.reported_by and i.reporter_type = 'USER'
`;

function incidentDto(i: IncidentRow) {
  return {
    id: i.id,
    number: formatIncidentNumber(i.number),
    type: i.incident_type,
    status: i.status,
    source: i.source,
    customerId: i.customer_id,
    customerName: i.customer_name,
    orderId: i.order_id,
    orderNumber: i.order_number ? formatOrderNumber(i.order_number) : null,
    routeId: i.route_id,
    productId: i.product_id,
    productName: i.product_name,
    quantity: i.quantity,
    description: i.description,
    details: i.details,
    damageClass: i.damage_class,
    decision: i.decision,
    chargeCustomer: i.charge_customer,
    chargeAmountCents: i.charge_amount_cents === null ? null : Number(i.charge_amount_cents),
    assignedTo: i.assigned_to,
    assignedName: i.assigned_name,
    reporterName: i.reporter_name,
    resolution: i.resolution,
    resolvedAt: i.resolved_at?.toISOString() ?? null,
    createdAt: i.created_at.toISOString(),
  };
}

export async function listIncidents(actor: UserActor, q: z.infer<typeof incidentListQuerySchema>) {
  authorize(actor, 'incident.read');
  const pageSize = 30;
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const types = q.type ? [q.type] : q.group === 'loss_damage' ? LOSS_DAMAGE_TYPES : null;
    const rows = await tx.unsafe<IncidentRow[]>(
      `select ${INCIDENT_SELECT} ${INCIDENT_FROM}
        where i.organization_id = app.current_org_id()
          and ($1::text is null or i.status = $1)
          and ($2::text[] is null or i.incident_type = any ($2::text[]))
          and ($3::uuid is null or i.customer_id = $3)
          and ($4::boolean is null or ($4 and i.status in ('OPEN', 'UNDER_REVIEW')) or (not $4 and i.status in ('RESOLVED', 'CANCELLED')))
        order by i.status in ('OPEN', 'UNDER_REVIEW') desc, i.created_at desc
        limit $5 offset $6`,
      [q.status ?? null, types, q.customerId ?? null, q.open === undefined ? null : q.open === 'true', pageSize + 1, (q.page - 1) * pageSize],
    );
    const [counts] = await tx<{ open: number; review: number }[]>`
      select count(*) filter (where status = 'OPEN')::int as open, count(*) filter (where status = 'UNDER_REVIEW')::int as review
        from public.incidents where organization_id = app.current_org_id()`;
    return { items: rows.slice(0, pageSize).map(incidentDto), hasMore: rows.length > pageSize, counts };
  });
}

async function findIncident(tx: Tx, id: string, forUpdate = false): Promise<IncidentRow | null> {
  if (forUpdate) await tx`select 1 from public.incidents where id = ${id} and organization_id = app.current_org_id() for update`;
  const [row] = await tx.unsafe<IncidentRow[]>(`select ${INCIDENT_SELECT} ${INCIDENT_FROM} where i.id = $1 and i.organization_id = app.current_org_id()`, [id]);
  return row ?? null;
}

function shapeOf(i: IncidentRow) {
  return {
    type: i.incident_type,
    quantity: i.quantity,
    productId: i.product_id,
    customerId: i.customer_id,
    // Enxoval do cliente não é estoque da empresa: a ocorrência só registra e resolve, nunca movimenta.
    stage: i.product_kind === 'LINEN' ? ('SERVICE' as const) : ((i.details.stage as 'COLLECTION' | 'DELIVERY' | 'RECEIVING' | undefined) ?? null),
    location: (i.details.location as 'AWAITING_LAUNDRY' | 'DAMAGED' | undefined) ?? null,
    direction: (i.details.direction as 'MISSING' | 'EXTRA' | undefined) ?? null,
  };
}

async function customerBalance(tx: Tx, customerId: string | null, productId: string | null): Promise<number | null> {
  if (!customerId || !productId) return null;
  const [row] = await tx<{ q: number | null }[]>`select app.customer_product_balance(${customerId}, ${productId}) as q`;
  return row?.q ?? null;
}

export async function getIncidentDetail(actor: UserActor, id: string) {
  authorize(actor, 'incident.read');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const i = await findIncident(tx, id);
    if (!i) throw new NotFoundError('Ocorrência não encontrada.');
    const events = await tx<{ id: string; event_type: string; from_status: string | null; to_status: string | null; note: string | null; actor_name: string | null; created_at: Date }[]>`
      select e.id, e.event_type, e.from_status, e.to_status, e.note, p.full_name as actor_name, e.created_at
        from public.incident_events e left join public.profiles p on p.id = e.actor_id and e.actor_type = 'USER'
       where e.incident_id = ${id} order by e.created_at, e.id`;
    const canFinance = hasPermission(actor, 'finance.read') || hasPermission(actor, 'incident.manage');
    const billable = canFinance
      ? (await tx<{ id: string; amount_cents: string; status: string }[]>`
          select id, amount_cents::text, status from public.billable_events where source_type = 'INCIDENT' and source_id = ${id}`)[0] ?? null
      : null;
    const open = i.status === 'OPEN' || i.status === 'UNDER_REVIEW';
    const manage = hasPermission(actor, 'incident.manage');
    return {
      incident: incidentDto(i),
      replacementPriceCents: i.replacement_price_cents === null ? null : Number(i.replacement_price_cents),
      customerBalance: await customerBalance(tx, i.customer_id, i.product_id),
      events: events.map((e) => ({ id: e.id, type: e.event_type, from: e.from_status, to: e.to_status, note: e.note, actorName: e.actor_name, at: e.created_at.toISOString() })),
      attachmentIds: await listAttachmentIds(tx, 'incident', id),
      billable: billable ? { id: billable.id, amountCents: Number(billable.amount_cents), status: billable.status } : null,
      actions: {
        review: manage && i.status === 'OPEN',
        reopen: manage && i.status === 'UNDER_REVIEW',
        cancel: manage && open,
        resolve: manage && open,
        canCharge: hasPermission(actor, 'finance.create_charge'),
        decisions: manage && open ? allowedDecisions(shapeOf(i)) : [],
      },
    };
  });
}

// -----------------------------------------------------------------------------
// Fluxo: análise, cancelamento, responsável
// -----------------------------------------------------------------------------

export const incidentStatusSchema = z.strictObject({
  to: z.enum(['OPEN', 'UNDER_REVIEW', 'CANCELLED']),
  note: z.string().trim().max(2000).optional(),
});

export async function changeIncidentStatus(actor: UserActor, id: string, input: z.infer<typeof incidentStatusSchema>) {
  authorize(actor, 'incident.manage');
  if (input.to === 'CANCELLED' && (!input.note || input.note.length < 3)) throw new ValidationError('Informe o motivo do cancelamento.', [{ path: 'note', message: 'obrigatório' }]);
  const r = await withActorTransaction(toDbContext(actor), async (tx) => {
    const i = await findIncident(tx, id, true);
    if (!i) throw new NotFoundError('Ocorrência não encontrada.');
    incidentStateMachine.assertTransition(i.status, input.to);
    await tx`update public.incidents set status = ${input.to} where id = ${id}`;
    await insertEvent(tx, actor, id, 'STATUS_CHANGED', i.status, input.to, input.note ?? null);
    await recordAudit(tx, actor, actor.organizationId, { action: 'incident.status_changed', entityType: 'incident', entityId: id, before: { status: i.status }, after: { status: input.to }, metadata: { note: input.note ?? null } });
    return { status: input.to };
  });
  if (input.to === 'CANCELLED') await resolveIncidentAlert(actor.organizationId, id);
  return r;
}

export const assignIncidentSchema = z.strictObject({ userId: z.uuid().nullable() });

export async function assignIncident(actor: UserActor, id: string, userId: string | null) {
  authorize(actor, 'incident.manage');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const i = await findIncident(tx, id, true);
    if (!i) throw new NotFoundError('Ocorrência não encontrada.');
    if (userId) {
      const [m] = await tx`select 1 from public.organization_members where organization_id = app.current_org_id() and user_id = ${userId} and status = 'active'`;
      if (!m) throw new ValidationError('Responsável precisa ser membro ativo da equipe.');
    }
    await tx`update public.incidents set assigned_to = ${userId} where id = ${id}`;
    await insertEvent(tx, actor, id, 'ASSIGNED', null, null, null, { assigned_to: userId });
    await recordAudit(tx, actor, actor.organizationId, { action: 'incident.assigned', entityType: 'incident', entityId: id, before: { assigned_to: i.assigned_to }, after: { assigned_to: userId } });
    return { assignedTo: userId };
  });
}

// -----------------------------------------------------------------------------
// Resolução com decisão (movimentos de estoque + fato cobrável, uma única vez)
// -----------------------------------------------------------------------------

export const resolveIncidentSchema = z.strictObject({
  decision: z.enum(DECISIONS),
  resolution: z.string().trim().min(3).max(2000),
  /** Só para REGISTER_LOSS: cobrar o cliente pela perda. */
  chargeCustomer: z.boolean().default(false),
  damageClass: z.enum(DAMAGE_CLASSES).nullable().optional(),
});
export type ResolveInput = z.infer<typeof resolveIncidentSchema>;

interface Plan {
  movements: MovementInput[];
  charge: { kind: 'LOSS' | 'DAMAGE'; quantity: number; unitCents: number; amountCents: number } | null;
  summary: string;
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function brl(c: number) {
  return (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Monta o impacto da decisão (mesma função para a prévia e para a execução). */
interface Prices {
  lossCents: number;
  damageCents: number;
  /** Contrato de onde veio o preço (null = preço de reposição do produto). */
  contractId: string | null;
}

/** Preço de perda/dano: o do contrato vigente do cliente, senão o de reposição do produto. */
async function pricesFor(tx: Tx, i: IncidentRow): Promise<Prices> {
  const replacement = i.replacement_price_cents === null ? 0 : Number(i.replacement_price_cents);
  if (!i.customer_id || !i.product_id) return { lossCents: replacement, damageCents: replacement, contractId: null };
  const [c] = await tx<{ loss_price_cents: string | null; damage_price_cents: string | null; contract_id: string }[]>`
    select loss_price_cents::text, damage_price_cents::text, contract_id from app.contract_loss_damage_price(${i.customer_id}, ${i.product_id})`;
  return {
    lossCents: lossDamagePrice(c ? { lossPriceCents: c.loss_price_cents === null ? null : Number(c.loss_price_cents), damagePriceCents: null } : null, 'LOSS', replacement),
    damageCents: lossDamagePrice(c ? { lossPriceCents: null, damagePriceCents: c.damage_price_cents === null ? null : Number(c.damage_price_cents) } : null, 'DAMAGE', replacement),
    contractId: c?.contract_id ?? null,
  };
}

function planResolution(i: IncidentRow, input: ResolveInput, balance: number | null, prices: Prices): Plan {
  const allowed = allowedDecisions(shapeOf(i));
  if (!allowed.includes(input.decision)) throw new BusinessRuleError('Decisão não se aplica a este tipo de ocorrência.');
  const qty = i.quantity;
  const product = i.product_name ?? 'produto';
  const customer = i.customer_name ?? 'o cliente';
  const base = { productId: i.product_id!, customerId: i.customer_id, orderId: i.order_id, routeId: i.route_id, routeStopId: i.route_stop_id, reason: `Ocorrência ${formatIncidentNumber(i.number)}: ${input.resolution}` };
  const key = (step: string) => `incident:${i.id}:${step}`;
  // Toalhas separadas para lavar precisam antes ser marcadas como danificadas; as da inspeção já estão.
  const alreadyDamaged = i.details.location === 'DAMAGED';
  const toDamaged: MovementInput[] = alreadyDamaged ? [] : [{ ...base, type: 'DAMAGE', quantity: qty, from: 'AWAITING_LAUNDRY', to: 'DAMAGED', idempotencyKey: key('damage') }];
  const internal = i.details.stage === 'RECEIVING';

  switch (input.decision) {
    case 'NO_ACTION':
      return { movements: [], charge: null, summary: 'Nenhuma movimentação de estoque nem cobrança.' };
    case 'RETURN_TO_LAUNDRY':
      return {
        movements: alreadyDamaged ? [{ ...base, type: 'TRANSFER', quantity: qty, from: 'DAMAGED', to: 'AWAITING_LAUNDRY', idempotencyKey: key('to_laundry') }] : [],
        charge: null,
        summary: `${plural(qty, 'toalha', 'toalhas')} de ${product} ${alreadyDamaged ? (qty === 1 ? 'volta' : 'voltam') + ' para a fila de lavagem' : (qty === 1 ? 'segue' : 'seguem') + ' para a lavagem normalmente'}.`,
      };
    case 'RETURN_TO_STOCK':
      return {
        movements: [...toDamaged, { ...base, type: 'TRANSFER', quantity: qty, from: 'DAMAGED', to: 'AVAILABLE', idempotencyKey: key('to_stock') }],
        charge: null,
        summary: `${plural(qty, 'toalha', 'toalhas')} de ${product} ${qty === 1 ? 'volta' : 'voltam'} ao estoque disponível.`,
      };
    case 'DISCARD':
    case 'CHARGE_CUSTOMER': {
      const movements: MovementInput[] = [...toDamaged, { ...base, type: 'DISCARD', quantity: qty, from: 'DAMAGED', to: 'DISCARDED', idempotencyKey: key('discard') }];
      if (input.decision === 'DISCARD') return { movements, charge: null, summary: `${plural(qty, 'toalha', 'toalhas')} de ${product} ${qty === 1 ? 'será descartada' : 'serão descartadas'}, sem cobrança.` };
      const unit = prices.damageCents;
      const amount = multiplyCents(cents(unit), qty);
      return {
        movements,
        charge: { kind: 'DAMAGE', quantity: qty, unitCents: unit, amountCents: amount },
        summary: `${plural(qty, 'toalha', 'toalhas')} de ${product} ${qty === 1 ? 'será descartada' : 'serão descartadas'} e ${customer} será cobrado em ${brl(amount)} (${qty} × ${brl(unit)}).`,
      };
    }
    case 'REGISTER_LOSS': {
      if (internal) {
        if (input.chargeCustomer) throw new BusinessRuleError('Falta na conferência é perda interna: não gera cobrança ao cliente.');
        return {
          movements: [{ ...base, customerId: null, type: 'LOSS', quantity: qty, from: 'AWAITING_LAUNDRY', to: 'LOST', idempotencyKey: key('loss') }],
          charge: null,
          summary: `${plural(qty, 'toalha', 'toalhas')} de ${product} que não ${qty === 1 ? 'chegou' : 'chegaram'} à base ${qty === 1 ? 'será registrada como perdida' : 'serão registradas como perdidas'} (perda interna, sem cobrança).`,
        };
      }
      if (balance !== null && qty > balance) throw new BusinessRuleError(`O cliente tem ${balance} toalha(s) deste produto no sistema; não é possível registrar perda de ${qty}.`);
      const movements: MovementInput[] = [{ ...base, type: 'LOSS', quantity: qty, from: 'WITH_CUSTOMER', to: 'LOST', idempotencyKey: key('loss') }];
      const after = balance === null ? null : balance - qty;
      const saldo = after === null ? '' : `, reduzindo o saldo dele para ${after}`;
      if (!input.chargeCustomer) return { movements, charge: null, summary: `${plural(qty, 'toalha', 'toalhas')} de ${product} ${qty === 1 ? 'será registrada como perdida' : 'serão registradas como perdidas'} para ${customer}${saldo}, sem cobrança.` };
      const unit = prices.lossCents;
      const amount = multiplyCents(cents(unit), qty);
      return {
        movements,
        charge: { kind: 'LOSS', quantity: qty, unitCents: unit, amountCents: amount },
        summary: `${plural(qty, 'toalha', 'toalhas')} de ${product} ${qty === 1 ? 'será registrada como perdida' : 'serão registradas como perdidas'} para ${customer}${saldo} e gerando cobrança de ${brl(amount)}.`,
      };
    }
  }
}

export async function previewResolution(actor: UserActor, id: string, input: ResolveInput) {
  authorize(actor, 'incident.manage');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const i = await findIncident(tx, id);
    if (!i) throw new NotFoundError('Ocorrência não encontrada.');
    const plan = planResolution(i, input, await customerBalance(tx, i.customer_id, i.product_id), await pricesFor(tx, i));
    return {
      summary: plan.summary,
      movements: plan.movements.map((m) => ({ type: m.type, quantity: m.quantity, from: m.from, to: m.to })),
      chargeAmountCents: plan.charge?.amountCents ?? null,
      requiresChargePermission: plan.charge !== null && !hasPermission(actor, 'finance.create_charge'),
    };
  });
}

export async function resolveIncident(actor: UserActor, id: string, input: ResolveInput) {
  authorize(actor, 'incident.manage');
  const result = await withActorTransaction(toDbContext(actor), async (tx) => {
    const i = await findIncident(tx, id, true);
    if (!i) throw new NotFoundError('Ocorrência não encontrada.');
    incidentStateMachine.assertTransition(i.status, 'RESOLVED');
    const plan = planResolution(i, input, await customerBalance(tx, i.customer_id, i.product_id), await pricesFor(tx, i));
    if (plan.charge) authorize(actor, 'finance.create_charge');
    if (plan.movements.length) await recordMovements(tx, actor, plan.movements);

    let billableId: string | null = null;
    if (plan.charge) {
      if (!i.customer_id) throw new BusinessRuleError('Ocorrência sem cliente não pode gerar cobrança.');
      const [b] = await tx<{ id: string }[]>`
        insert into public.billable_events (organization_id, customer_id, source_type, source_id, kind, description, product_id, quantity,
                                            unit_price_cents, amount_cents, created_by)
        values (${actor.organizationId}, ${i.customer_id}, 'INCIDENT', ${i.id}, ${plan.charge.kind},
                ${`${plan.charge.kind === 'LOSS' ? 'Perda' : 'Dano'} de ${plan.charge.quantity} × ${i.product_name ?? 'toalha'} (${formatIncidentNumber(i.number)})`},
                ${i.product_id}, ${plan.charge.quantity}, ${plan.charge.unitCents}, ${plan.charge.amountCents}, ${actor.userId})
        returning id`;
      billableId = b!.id;
      await recordOutboxEvent(tx, {
        organizationId: actor.organizationId,
        eventType: 'BillableEventCreated',
        aggregateType: 'billable_event',
        aggregateId: billableId,
        payload: { billable_event_id: billableId, customer_id: i.customer_id, kind: plan.charge.kind, amount_cents: plan.charge.amountCents, incident_id: i.id },
        idempotencyKey: `BillableEventCreated:${billableId}`,
      });
    }
    await tx`
      update public.incidents
         set status = 'RESOLVED', decision = ${input.decision}, resolution = ${input.resolution}, resolved_at = now(), resolved_by = ${actor.userId},
             charge_customer = ${plan.charge !== null}, charge_amount_cents = ${plan.charge?.amountCents ?? null},
             damage_class = coalesce(${input.damageClass ?? null}, damage_class)
       where id = ${id}`;
    await insertEvent(tx, actor, id, 'RESOLVED', i.status, 'RESOLVED', input.resolution, { decision: input.decision, summary: plan.summary, billable_event_id: billableId });
    await recordAudit(tx, actor, actor.organizationId, {
      action: plan.charge ? 'incident.resolved_with_charge' : 'incident.resolved',
      entityType: 'incident',
      entityId: id,
      before: { status: i.status },
      after: { status: 'RESOLVED', decision: input.decision, charge_amount_cents: plan.charge?.amountCents ?? null },
      metadata: { resolution: input.resolution, summary: plan.summary },
    });
    await recordOutboxEvent(tx, {
      organizationId: actor.organizationId,
      eventType: 'IncidentResolved',
      aggregateType: 'incident',
      aggregateId: id,
      payload: { incident_id: id, decision: input.decision, billable_event_id: billableId },
      idempotencyKey: `IncidentResolved:${id}`,
    });
    return { status: 'RESOLVED' as const, summary: plan.summary, billableEventId: billableId };
  });
  await resolveIncidentAlert(actor.organizationId, id);
  return result;
}
