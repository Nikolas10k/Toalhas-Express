import 'server-only';
import { z } from 'zod';
import { toDbContext, type UserActor } from '@/server/auth/actor';
import { authorize } from '@/server/authz/authorize';
import { BusinessRuleError, InventoryError, NotFoundError, ValidationError } from '@/server/core/errors';
import type { Tx } from '@/server/db/client';
import { withActorTransaction } from '@/server/db/transaction';
import { recordAudit } from '@/server/modules/audit/audit.service';
import { executeIdempotent } from '@/server/modules/idempotency/idempotency.service';
import { DAMAGE_CLASSES, type IncidentType } from '@/server/modules/incidents/incidents.domain';
import { createIncidentRow, openIncidentAlert } from '@/server/modules/incidents/incidents.service';
import type { MovementInput } from '@/server/modules/inventory/inventory.domain';
import { recordMovements } from '@/server/modules/inventory/inventory.service';
import { recordOutboxEvent } from '@/server/modules/outbox/outbox.service';
import { assertInspectionCloses, formatBatchNumber, laundryStateMachine, LAUNDRY_STATUSES, MANUAL_STEPS, type LaundryStatus } from './laundry.domain';

type Alert = { id: string; number: string; type: IncidentType; title: string };

async function event(tx: Tx, actor: UserActor, batchId: string, from: string | null, to: string, note: string | null = null) {
  await tx`
    insert into public.laundry_batch_events (organization_id, batch_id, from_status, to_status, note, actor_type, actor_id, created_at)
    values (${actor.organizationId}, ${batchId}, ${from}, ${to}, ${note}, 'USER', ${actor.userId}, clock_timestamp())`;
}

// -----------------------------------------------------------------------------
// Visão geral: fila, lotes em andamento, rotas a conferir
// -----------------------------------------------------------------------------

export async function getLaundryOverview(actor: UserActor) {
  authorize(actor, 'laundry.read');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const queue = await tx<{ product_id: string; sku: string; name: string; awaiting: string; in_laundry: string; in_inspection: string }[]>`
      select * from app.laundry_queue()`;
    const pending = await tx<{ route_id: string; route_date: string; driver_name: string; product_id: string; product_name: string; expected: string }[]>`
      select route_id, route_date::text as route_date, driver_name, product_id, product_name, expected from app.pending_laundry_receipts()
       where route_date >= (now() at time zone 'America/Sao_Paulo')::date - 3`;
    const receipts = new Map<string, { routeId: string; date: string; driverName: string; items: { productId: string; name: string; expected: number }[] }>();
    for (const p of pending) {
      const r = receipts.get(p.route_id) ?? { routeId: p.route_id, date: p.route_date, driverName: p.driver_name, items: [] };
      r.items.push({ productId: p.product_id, name: p.product_name, expected: Number(p.expected) });
      receipts.set(p.route_id, r);
    }
    return {
      queue: queue.map((q) => ({ productId: q.product_id, sku: q.sku, name: q.name, awaiting: Number(q.awaiting), inLaundry: Number(q.in_laundry), inInspection: Number(q.in_inspection) })),
      pendingReceipts: [...receipts.values()],
    };
  });
}

// -----------------------------------------------------------------------------
// Recebimento/conferência
// -----------------------------------------------------------------------------

export const receiveRouteSchema = z.strictObject({
  items: z.array(z.strictObject({ productId: z.uuid(), counted: z.number().int().min(0).max(100000) })).min(1).max(30),
  notes: z.string().trim().max(1000).nullable().optional().transform((v) => v || null),
});

/**
 * Conta o que chegou das coletas de uma rota. Diferença vira ocorrência
 * (falta = possível perda interna; sobra = investigar). O estoque não é
 * corrigido aqui: a decisão da ocorrência é que movimenta, com auditoria.
 */
export async function receiveRoute(actor: UserActor, routeId: string, input: z.infer<typeof receiveRouteSchema>) {
  authorize(actor, 'laundry.manage');
  authorize(actor, 'incident.report');
  const alerts: Alert[] = [];
  const result = await withActorTransaction(toDbContext(actor), async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${`laundry:receipt:${routeId}`}, 0))`;
    const [done] = await tx<{ id: string }[]>`select id from public.laundry_receipts where route_id = ${routeId}`;
    if (done) return { receiptId: done.id, replayed: true, incidents: [] as string[] };
    const expected = await tx<{ product_id: string; product_name: string; expected: string }[]>`
      select product_id, product_name, expected from app.pending_laundry_receipts() where route_id = ${routeId}`;
    if (expected.length === 0) throw new NotFoundError('Rota sem coleta pendente de conferência.');
    const exp = new Map(expected.map((e) => [e.product_id, { name: e.product_name, qty: Number(e.expected) }]));
    const counted = new Map<string, number>();
    for (const it of input.items) {
      if (counted.has(it.productId)) throw new ValidationError('Produto repetido.');
      counted.set(it.productId, it.counted);
    }
    for (const id of exp.keys()) if (!counted.has(id)) throw new ValidationError('Informe a contagem de todos os produtos coletados.', [{ path: 'items', message: id }]);
    const names = new Map((await tx<{ id: string; name: string }[]>`
      select id, name from public.products where organization_id = app.current_org_id() and id = any (${[...counted.keys()]}::uuid[])`).map((p) => [p.id, p.name]));
    if (names.size !== counted.size) throw new NotFoundError('Produto não encontrado.');

    const [rec] = await tx<{ id: string }[]>`
      insert into public.laundry_receipts (organization_id, route_id, notes, actor_type, actor_id)
      values (${actor.organizationId}, ${routeId}, ${input.notes}, 'USER', ${actor.userId}) returning id`;
    const incidents: string[] = [];
    for (const [productId, c] of counted) {
      const e = exp.get(productId)?.qty ?? 0;
      await tx`
        insert into public.laundry_receipt_items (organization_id, receipt_id, product_id, expected, counted)
        values (${actor.organizationId}, ${rec!.id}, ${productId}, ${e}, ${c})`;
      if (c === e) continue;
      const name = names.get(productId)!;
      const missing = c < e;
      const description = missing
        ? `Conferência na base: ${name} coletadas ${e}, chegaram ${c}. Faltam ${e - c}.`
        : `Conferência na base: ${name} coletadas ${e}, chegaram ${c}. Sobraram ${c - e}.`;
      const inc = await createIncidentRow(tx, actor, {
        type: 'QUANTITY_DIVERGENCE', source: 'STAFF', description, routeId, productId, quantity: Math.abs(e - c),
        details: { stage: 'RECEIVING', direction: missing ? 'MISSING' : 'EXTRA', expected: e, actual: c, location: 'AWAITING_LAUNDRY', receipt_id: rec!.id },
      });
      incidents.push(inc.id);
      alerts.push({ ...inc, type: 'QUANTITY_DIVERGENCE', title: description });
    }
    await recordAudit(tx, actor, actor.organizationId, { action: 'laundry.route_received', entityType: 'route', entityId: routeId, after: { items: input.items, incidents } });
    return { receiptId: rec!.id, replayed: false, incidents };
  });
  for (const a of alerts) await openIncidentAlert(actor.organizationId, a);
  return result;
}

// -----------------------------------------------------------------------------
// Lotes
// -----------------------------------------------------------------------------

export const createBatchSchema = z.strictObject({
  items: z.array(z.strictObject({ productId: z.uuid(), quantity: z.number().int().min(1).max(100000) })).min(1).max(30),
  provider: z.string().trim().max(120).nullable().optional().transform((v) => v || null),
  notes: z.string().trim().max(1000).nullable().optional().transform((v) => v || null),
});

/** Monta o lote tirando as toalhas da fila (aguardando lavagem → em lavagem). */
async function createBatchIn(tx: Tx, actor: UserActor, input: z.infer<typeof createBatchSchema>) {
  const ids = input.items.map((i) => i.productId);
  if (new Set(ids).size !== ids.length) throw new ValidationError('Produto repetido no lote.');
  const [{ n }] = (await tx`select app.next_laundry_number(${actor.organizationId}) as n`) as unknown as [{ n: string }];
  const [b] = await tx<{ id: string }[]>`
    insert into public.laundry_batches (organization_id, number, provider, notes, created_by)
    values (${actor.organizationId}, ${n}, ${input.provider}, ${input.notes}, ${actor.userId}) returning id`;
  const batchId = b!.id;
  for (const it of input.items) {
    await tx`insert into public.laundry_batch_items (organization_id, batch_id, product_id, quantity)
             values (${actor.organizationId}, ${batchId}, ${it.productId}, ${it.quantity})`;
  }
  try {
    await recordMovements(
      tx,
      actor,
      input.items.map((it) => ({
        productId: it.productId, type: 'LAUNDRY_ENTRY' as const, quantity: it.quantity, from: 'AWAITING_LAUNDRY' as const, to: 'IN_LAUNDRY' as const,
        laundryBatchId: batchId, reason: `Lote ${formatBatchNumber(n)}`, idempotencyKey: `laundry:${batchId}:entry:${it.productId}`,
      })),
    );
  } catch (err) {
    if (err instanceof InventoryError) throw new InventoryError('Quantidade maior que o que está aguardando lavagem deste produto.', err.details);
    throw err;
  }
  await event(tx, actor, batchId, null, 'WAITING');
  await recordAudit(tx, actor, actor.organizationId, { action: 'laundry.batch_created', entityType: 'laundry_batch', entityId: batchId, after: { ...input, number: n } });
  return { id: batchId, number: formatBatchNumber(n), rawNumber: n };
}

export async function createBatch(actor: UserActor, input: z.infer<typeof createBatchSchema>, idempotencyKey?: string) {
  authorize(actor, 'laundry.manage');
  const run = async (tx: Tx) => {
    const { id, number } = await createBatchIn(tx, actor, input);
    return { id, number };
  };
  if (idempotencyKey) return (await executeIdempotent(actor, { scope: 'laundry.batch_create', key: idempotencyKey, request: input }, run)).result;
  return withActorTransaction(toDbContext(actor), run);
}

interface BatchRow {
  id: string;
  number: string;
  status: LaundryStatus;
  provider: string | null;
  notes: string | null;
  status_reason: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
}

async function lockBatch(tx: Tx, id: string): Promise<BatchRow> {
  const [b] = await tx<BatchRow[]>`
    select id, number::text as number, status, provider, notes, status_reason, started_at, completed_at, created_at
      from public.laundry_batches where id = ${id} and organization_id = app.current_org_id() for update`;
  if (!b) throw new NotFoundError('Lote não encontrado.');
  return b;
}

async function batchItems(tx: Tx, id: string) {
  return tx<{ product_id: string; name: string; quantity: number }[]>`
    select i.product_id, p.name, i.quantity from public.laundry_batch_items i join public.products p on p.id = i.product_id
     where i.batch_id = ${id} order by p.name`;
}

export const advanceBatchSchema = z.strictObject({
  to: z.enum(['WASHING', 'DRYING', 'FOLDING', 'INSPECTION', 'CANCELLED']),
  note: z.string().trim().max(500).nullable().optional().transform((v) => v || null),
});

/** Avança a etapa. FOLDING → INSPECTION tira as toalhas da lavagem; cancelar devolve à fila. */
export async function advanceBatch(actor: UserActor, id: string, input: z.infer<typeof advanceBatchSchema>) {
  authorize(actor, 'laundry.manage');
  if (input.to === 'CANCELLED' && (!input.note || input.note.length < 3)) throw new ValidationError('Informe o motivo do cancelamento.', [{ path: 'note', message: 'obrigatório' }]);
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const b = await lockBatch(tx, id);
    if (b.status === input.to) return { status: b.status, replayed: true };
    if (input.to !== 'CANCELLED' && !MANUAL_STEPS.has(input.to)) throw new BusinessRuleError('Etapa inválida.');
    laundryStateMachine.assertTransition(b.status, input.to);
    const items = await batchItems(tx, id);
    const label = formatBatchNumber(b.number);
    if (input.to === 'INSPECTION') {
      await recordMovements(tx, actor, items.map((i) => ({
        productId: i.product_id, type: 'LAUNDRY_EXIT' as const, quantity: i.quantity, from: 'IN_LAUNDRY' as const, to: 'IN_INSPECTION' as const,
        laundryBatchId: id, reason: `Lote ${label}: saída para inspeção`, idempotencyKey: `laundry:${id}:exit:${i.product_id}`,
      })));
    }
    if (input.to === 'CANCELLED') {
      await recordMovements(tx, actor, items.map((i) => ({
        productId: i.product_id, type: 'TRANSFER' as const, quantity: i.quantity, from: 'IN_LAUNDRY' as const, to: 'AWAITING_LAUNDRY' as const,
        laundryBatchId: id, reason: `Lote ${label} cancelado: ${input.note}`, idempotencyKey: `laundry:${id}:cancel:${i.product_id}`,
        authorizedBy: 'laundry.manage' as const,
      })));
    }
    await tx`
      update public.laundry_batches
         set status = ${input.to}, status_reason = ${input.note},
             started_at = case when ${input.to} = 'WASHING' then now() else started_at end,
             completed_at = case when ${input.to} = 'CANCELLED' then now() else completed_at end
       where id = ${id}`;
    await event(tx, actor, id, b.status, input.to, input.note);
    if (input.to === 'CANCELLED') {
      await recordAudit(tx, actor, actor.organizationId, { action: 'laundry.batch_cancelled', entityType: 'laundry_batch', entityId: id, before: { status: b.status }, after: { status: 'CANCELLED' }, metadata: { reason: input.note } });
    }
    return { status: input.to, replayed: false };
  });
}

export const inspectionSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        productId: z.uuid(),
        available: z.number().int().min(0).max(100000),
        damaged: z.number().int().min(0).max(100000),
        discarded: z.number().int().min(0).max(100000),
        notes: z.string().trim().max(500).nullable().optional().transform((v) => v || null),
      }),
    )
    .min(1)
    .max(30),
  damageClass: z.enum(DAMAGE_CLASSES).nullable().optional(),
});

type InspectionInput = z.infer<typeof inspectionSchema>;

/** Dá destino a cada toalha em inspeção (disponível / dano → ocorrência / descarte) e conclui o lote. */
async function applyInspection(
  tx: Tx,
  actor: UserActor,
  b: { id: string; number: string; status: LaundryStatus },
  items: { product_id: string; name: string; quantity: number }[],
  input: InspectionInput,
  alerts: Alert[],
) {
  const id = b.id;
  const byProduct = new Map(input.items.map((i) => [i.productId, i]));
  if (byProduct.size !== input.items.length) throw new ValidationError('Produto repetido.');
  if (items.length !== byProduct.size || items.some((i) => !byProduct.has(i.product_id))) {
    throw new ValidationError('Informe a inspeção de todos os produtos do lote.');
  }
  const totalDamaged = input.items.reduce((a, i) => a + i.damaged, 0);
  if (totalDamaged > 0 && !input.damageClass) throw new ValidationError('Informe o tipo de dano.', [{ path: 'damageClass', message: 'obrigatório' }]);

  const label = formatBatchNumber(b.number);
  const movements: MovementInput[] = [];
  for (const it of items) {
    const r = byProduct.get(it.product_id)!;
    assertInspectionCloses(it.name, { quantity: it.quantity, ...r });
    await tx`
      insert into public.laundry_inspections (organization_id, batch_id, product_id, available, damaged, discarded, notes)
      values (${actor.organizationId}, ${id}, ${it.product_id}, ${r.available}, ${r.damaged}, ${r.discarded}, ${r.notes ?? null})`;
    const base = { productId: it.product_id, laundryBatchId: id, authorizedBy: 'laundry.manage' as const };
    const key = (k: string) => `laundry:${id}:inspection:${it.product_id}:${k}`;
    if (r.available) movements.push({ ...base, type: 'TRANSFER', quantity: r.available, from: 'IN_INSPECTION', to: 'AVAILABLE', reason: `Lote ${label}: aprovadas na inspeção`, idempotencyKey: key('ok') });
    if (r.damaged) movements.push({ ...base, type: 'DAMAGE', quantity: r.damaged, from: 'IN_INSPECTION', to: 'DAMAGED', reason: `Lote ${label}: dano na inspeção`, idempotencyKey: key('damaged') });
    if (r.discarded) movements.push({ ...base, type: 'DISCARD', quantity: r.discarded, from: 'IN_INSPECTION', to: 'DISCARDED', reason: `Lote ${label}: descarte na inspeção${r.notes ? ` (${r.notes})` : ''}`, idempotencyKey: key('discard') });
  }
  if (movements.length) await recordMovements(tx, actor, movements);

  const incidents: string[] = [];
  for (const it of items) {
    const r = byProduct.get(it.product_id)!;
    if (!r.damaged) continue;
    authorize(actor, 'incident.report');
    const description = `Lote ${label}: ${r.damaged} toalha(s) de ${it.name} com dano na inspeção.${r.notes ? ` ${r.notes}` : ''}`;
    const inc = await createIncidentRow(tx, actor, {
      type: 'DAMAGED', source: 'STAFF', description, productId: it.product_id, quantity: r.damaged, damageClass: input.damageClass ?? null,
      details: { location: 'DAMAGED', laundry_batch_id: id },
    });
    incidents.push(inc.id);
    alerts.push({ ...inc, type: 'DAMAGED', title: description });
  }

  await tx`update public.laundry_batches set status = 'COMPLETED', completed_at = now(), started_at = coalesce(started_at, now()) where id = ${id}`;
  await event(tx, actor, id, b.status, 'COMPLETED');
  const totals = input.items.reduce((a, i) => ({ available: a.available + i.available, damaged: a.damaged + i.damaged, discarded: a.discarded + i.discarded }), { available: 0, damaged: 0, discarded: 0 });
  await recordAudit(tx, actor, actor.organizationId, { action: 'laundry.batch_completed', entityType: 'laundry_batch', entityId: id, after: { ...totals, incidents } });
  await recordOutboxEvent(tx, {
    organizationId: actor.organizationId,
    eventType: 'LaundryBatchCompleted',
    aggregateType: 'laundry_batch',
    aggregateId: id,
    payload: { batch_id: id, number: b.number, ...totals },
    idempotencyKey: `LaundryBatchCompleted:${id}`,
  });
  return incidents;
}

/**
 * Conclui o lote com o resultado da inspeção: cada toalha vai para
 * disponível, danificada (vira ocorrência para decidir o destino) ou descarte.
 */
export async function completeInspection(actor: UserActor, id: string, input: InspectionInput) {
  authorize(actor, 'laundry.manage');
  const alerts: Alert[] = [];
  const result = await withActorTransaction(toDbContext(actor), async (tx) => {
    const b = await lockBatch(tx, id);
    if (b.status === 'COMPLETED') return { status: b.status, replayed: true, incidents: [] as string[] };
    laundryStateMachine.assertTransition(b.status, 'COMPLETED');
    const incidents = await applyInspection(tx, actor, b, await batchItems(tx, id), input, alerts);
    return { status: 'COMPLETED' as const, replayed: false, incidents };
  });
  for (const a of alerts) await openIncidentAlert(actor.organizationId, a);
  return result;
}

// -----------------------------------------------------------------------------
// Processo enxuto: lançar produção (o que saiu limpo e dobrado) num passo só
// -----------------------------------------------------------------------------

export const productionSchema = inspectionSchema.extend({
  notes: z.string().trim().max(1000).nullable().optional().transform((v) => v || null),
});

/**
 * A equipe lava, seca e dobra sem registrar etapas. Ao sair o carrinho pronto,
 * o líder lança quantas saíram boas, com dano e para descarte. Por baixo é um
 * lote concluído (mesmo ledger: aguardando → em lavagem → inspeção → destino),
 * então o estoque continua fechando e a história fica auditável.
 */
export async function registerProduction(actor: UserActor, input: z.infer<typeof productionSchema>, idempotencyKey: string) {
  authorize(actor, 'laundry.manage');
  const alerts: Alert[] = [];
  const lines = input.items.map((i) => ({ productId: i.productId, quantity: i.available + i.damaged + i.discarded }));
  if (lines.some((l) => l.quantity === 0)) throw new ValidationError('Produto sem quantidade.');
  const { result } = await executeIdempotent(actor, { scope: 'laundry.production', key: idempotencyKey, request: input }, async (tx) => {
    const created = await createBatchIn(tx, actor, { items: lines, provider: null, notes: input.notes });
    const items = await batchItems(tx, created.id);
    await recordMovements(tx, actor, items.map((i) => ({
      productId: i.product_id, type: 'LAUNDRY_EXIT' as const, quantity: i.quantity, from: 'IN_LAUNDRY' as const, to: 'IN_INSPECTION' as const,
      laundryBatchId: created.id, reason: `Produção ${created.number}`, idempotencyKey: `laundry:${created.id}:exit:${i.product_id}`,
    })));
    const incidents = await applyInspection(tx, actor, { id: created.id, number: created.rawNumber, status: 'WAITING' }, items, input, alerts);
    return { id: created.id, number: created.number, incidents };
  });
  for (const a of alerts) await openIncidentAlert(actor.organizationId, a);
  return result;
}

// -----------------------------------------------------------------------------
// Consultas
// -----------------------------------------------------------------------------

export const batchListQuerySchema = z.strictObject({
  status: z.enum(LAUNDRY_STATUSES).optional(),
  open: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
});

export async function listBatches(actor: UserActor, q: z.infer<typeof batchListQuerySchema>) {
  authorize(actor, 'laundry.read');
  const pageSize = 30;
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const rows = await tx<(BatchRow & { total: number })[]>`
      select b.id, b.number::text as number, b.status, b.provider, b.notes, b.status_reason, b.started_at, b.completed_at, b.created_at,
             coalesce((select sum(i.quantity) from public.laundry_batch_items i where i.batch_id = b.id), 0)::int as total
        from public.laundry_batches b
       where b.organization_id = app.current_org_id()
         and (${q.status ?? null}::text is null or b.status = ${q.status ?? null})
         and (${q.open ?? null}::text is null or (${q.open === 'true'} and b.status not in ('COMPLETED', 'CANCELLED'))
              or (${q.open === 'false'} and b.status in ('COMPLETED', 'CANCELLED')))
       order by b.status in ('COMPLETED', 'CANCELLED'), b.created_at desc
       limit ${pageSize + 1} offset ${(q.page - 1) * pageSize}`;
    return {
      items: rows.slice(0, pageSize).map((b) => ({
        id: b.id,
        number: formatBatchNumber(b.number),
        status: b.status,
        provider: b.provider,
        total: b.total,
        startedAt: b.started_at?.toISOString() ?? null,
        completedAt: b.completed_at?.toISOString() ?? null,
        createdAt: b.created_at.toISOString(),
      })),
      hasMore: rows.length > pageSize,
    };
  });
}

export async function getBatchDetail(actor: UserActor, id: string) {
  authorize(actor, 'laundry.read');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const [b] = await tx<BatchRow[]>`
      select id, number::text as number, status, provider, notes, status_reason, started_at, completed_at, created_at
        from public.laundry_batches where id = ${id} and organization_id = app.current_org_id()`;
    if (!b) throw new NotFoundError('Lote não encontrado.');
    const items = await batchItems(tx, id);
    const inspections = await tx<{ product_id: string; available: number; damaged: number; discarded: number; notes: string | null }[]>`
      select product_id, available, damaged, discarded, notes from public.laundry_inspections where batch_id = ${id}`;
    const events = await tx<{ id: string; from_status: string | null; to_status: string; note: string | null; actor_name: string | null; created_at: Date }[]>`
      select e.id, e.from_status, e.to_status, e.note, p.full_name as actor_name, e.created_at
        from public.laundry_batch_events e left join public.profiles p on p.id = e.actor_id and e.actor_type = 'USER'
       where e.batch_id = ${id} order by e.created_at, e.id`;
    const insp = new Map(inspections.map((i) => [i.product_id, i]));
    const manage = actor.permissions.has('laundry.manage');
    return {
      batch: {
        id: b.id,
        number: formatBatchNumber(b.number),
        status: b.status,
        provider: b.provider,
        notes: b.notes,
        statusReason: b.status_reason,
        startedAt: b.started_at?.toISOString() ?? null,
        completedAt: b.completed_at?.toISOString() ?? null,
        createdAt: b.created_at.toISOString(),
      },
      items: items.map((i) => {
        const r = insp.get(i.product_id);
        return { productId: i.product_id, name: i.name, quantity: i.quantity, inspection: r ? { available: r.available, damaged: r.damaged, discarded: r.discarded, notes: r.notes } : null };
      }),
      events: events.map((e) => ({ id: e.id, from: e.from_status, to: e.to_status, note: e.note, actorName: e.actor_name, at: e.created_at.toISOString() })),
      next: manage ? laundryStateMachine.allowedFrom(b.status) : [],
    };
  });
}
