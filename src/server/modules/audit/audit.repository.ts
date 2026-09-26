import 'server-only';
import type { Tx } from '@/server/db/client';

export interface AuditInsert {
  id: string;
  organizationId: string | null;
  actorType: 'USER' | 'INTEGRATION' | 'SYSTEM' | 'WEBHOOK' | 'ANONYMOUS';
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  metadata: Record<string, unknown>;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  correlationId: string | null;
}

export async function insertAuditLog(tx: Tx, row: AuditInsert): Promise<void> {
  // Sem RETURNING: app_user pode inserir sem necessariamente poder ler.
  await tx`
    insert into public.audit_logs (
      id, organization_id, actor_type, actor_id, action, entity_type, entity_id,
      before, after, metadata, ip, user_agent, request_id, correlation_id
    ) values (
      ${row.id}, ${row.organizationId}, ${row.actorType}, ${row.actorId}, ${row.action},
      ${row.entityType}, ${row.entityId},
      ${row.before === undefined || row.before === null ? null : tx.json(row.before as never)},
      ${row.after === undefined || row.after === null ? null : tx.json(row.after as never)},
      ${tx.json(row.metadata as never)}, ${row.ip}, ${row.userAgent}, ${row.requestId}, ${row.correlationId}
    )
  `;
}

export interface AuditListFilters {
  action?: string;
  entityType?: string;
  entityId?: string;
  actorId?: string;
  cursor?: { createdAt: string; id: string };
  limit: number;
}

export interface AuditLogRow {
  id: string;
  actor_type: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before: unknown;
  after: unknown;
  metadata: Record<string, unknown>;
  ip: string | null;
  request_id: string | null;
  correlation_id: string | null;
  created_at: Date;
  /** created_at em texto com microssegundos (Date do JS perde precisão). */
  cursor_ts: string;
}

/** Paginação por cursor (created_at, id) — estável e sem OFFSET. */
export async function listAuditLogs(tx: Tx, f: AuditListFilters): Promise<AuditLogRow[]> {
  return tx<AuditLogRow[]>`
    select a.id, a.actor_type, a.actor_id, p.full_name as actor_name, a.action, a.entity_type, a.entity_id,
           a.before, a.after, a.metadata, host(a.ip) as ip, a.request_id, a.correlation_id, a.created_at,
           a.created_at::text as cursor_ts
    from public.audit_logs a
    left join public.profiles p on p.id = a.actor_id and a.actor_type = 'USER'
    where a.organization_id = app.current_org_id()
      ${f.action ? tx`and a.action = ${f.action}` : tx``}
      ${f.entityType ? tx`and a.entity_type = ${f.entityType}` : tx``}
      ${f.entityId ? tx`and a.entity_id = ${f.entityId}` : tx``}
      ${f.actorId ? tx`and a.actor_id = ${f.actorId}` : tx``}
      ${f.cursor ? tx`and (a.created_at, a.id) < (${f.cursor.createdAt}::timestamptz, ${f.cursor.id}::uuid)` : tx``}
    order by a.created_at desc, a.id desc
    limit ${f.limit}
  `;
}
