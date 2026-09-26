import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { toDbContext, type AuthenticatedActor, type SystemActor } from '@/server/auth/actor';
import { authorize } from '@/server/authz/authorize';
import { ValidationError } from '@/server/core/errors';
import { redact } from '@/server/core/logger';
import { getRequestContext } from '@/server/core/request-context';
import type { Tx } from '@/server/db/client';
import { withActorTransaction } from '@/server/db/transaction';
import { insertAuditLog, listAuditLogs } from './audit.repository';

export interface AuditEntry {
  /** Formato dominio.acao, ex.: customer.updated, finance.refund_requested */
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

/** Estrutural: aceita o ator completo ou só a identidade (ex.: eventos de login). */
export type AuditActor =
  | { type: 'USER'; userId: string }
  | { type: 'INTEGRATION'; tokenId: string }
  | SystemActor
  | { type: 'ANONYMOUS' }
  | { type: 'WEBHOOK'; provider: string };

/**
 * Grava auditoria NA MESMA transação da operação (se a operação falhar, o log
 * também é desfeito; se o log falhar, a operação não é confirmada).
 * Campos sensíveis (senha, token, cartão...) são mascarados.
 */
export async function recordAudit(
  tx: Tx,
  actor: AuditActor,
  organizationId: string | null,
  entry: AuditEntry,
): Promise<void> {
  const ctx = getRequestContext();
  const metadata = { ...(entry.metadata ?? {}) } as Record<string, unknown>;
  if (actor.type === 'SYSTEM') metadata.system_reason = actor.reason;
  if (actor.type === 'WEBHOOK') metadata.provider = actor.provider;

  await insertAuditLog(tx, {
    id: randomUUID(),
    organizationId,
    actorType: actor.type,
    actorId: actor.type === 'USER' ? actor.userId : actor.type === 'INTEGRATION' ? actor.tokenId : null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: entry.before === undefined ? null : redact(entry.before),
    after: entry.after === undefined ? null : redact(entry.after),
    metadata: redact(metadata) as Record<string, unknown>,
    ip: ctx?.ip ?? null,
    userAgent: ctx?.userAgent ?? null,
    requestId: ctx?.requestId ?? null,
    correlationId: ctx?.correlationId ?? null,
  });
}

export const auditListQuerySchema = z.strictObject({
  action: z.string().regex(/^[a-z_]+(\.[a-z_]+)+$/).max(100).optional(),
  entityType: z.string().regex(/^[a-z_]+$/).max(60).optional(),
  entityId: z.string().max(100).optional(),
  actorId: z.uuid().optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AuditListQuery = z.infer<typeof auditListQuerySchema>;

const CURSOR_TS = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)$/;

export function encodeCursor(createdAtText: string, id: string): string {
  return Buffer.from(JSON.stringify([createdAtText, id])).toString('base64url');
}

export function decodeCursor(cursor: string): { createdAt: string; id: string } {
  try {
    const parsed = z
      .tuple([z.string().regex(CURSOR_TS), z.uuid()])
      .parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    return { createdAt: parsed[0], id: parsed[1] };
  } catch {
    throw new ValidationError('Cursor de paginação inválido.', [{ path: 'cursor', message: 'inválido' }]);
  }
}

export async function listAuditLogsForActor(actor: AuthenticatedActor, query: AuditListQuery) {
  authorize(actor, 'audit.read');
  const rows = await withActorTransaction(toDbContext(actor), (tx) =>
    listAuditLogs(tx, {
      action: query.action,
      entityType: query.entityType,
      entityId: query.entityId,
      actorId: query.actorId,
      cursor: query.cursor ? decodeCursor(query.cursor) : undefined,
      limit: query.limit + 1,
    }),
  );
  const hasMore = rows.length > query.limit;
  const items = hasMore ? rows.slice(0, query.limit) : rows;
  const last = items.at(-1);
  return {
    items: items.map((r) => ({
      id: r.id,
      actorType: r.actor_type,
      actorId: r.actor_id,
      actorName: r.actor_name,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      before: r.before,
      after: r.after,
      metadata: r.metadata,
      ip: r.ip,
      requestId: r.request_id,
      correlationId: r.correlation_id,
      createdAt: r.created_at.toISOString(),
    })),
    nextCursor: hasMore && last ? encodeCursor(last.cursor_ts, last.id) : null,
  };
}
