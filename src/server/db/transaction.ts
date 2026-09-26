import 'server-only';
import { getRequestContext } from '@/server/core/request-context';
import { getSql, type Tx } from './client';

/** Contexto de banco derivado de um ator autenticado (nunca de input do cliente). */
export type DbActorContext =
  | { type: 'USER'; userId: string; organizationId: string | null }
  | { type: 'INTEGRATION'; tokenId: string; organizationId: string };

/**
 * Transação com RLS ATIVO: assume o role `app_user` e grava o contexto do ator
 * em GUCs locais da transação. Mesmo que um repositório esqueça um filtro de
 * organização, o banco não retorna nem aceita linhas de outro tenant.
 */
export async function withActorTransaction<T>(actor: DbActorContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const sql = getSql();
  const requestId = getRequestContext()?.requestId ?? '';
  return sql.begin(async (tx) => {
    await tx`
      select
        set_config('app.actor_type', ${actor.type}, true),
        set_config('app.user_id', ${actor.type === 'USER' ? actor.userId : ''}, true),
        set_config('app.integration_token_id', ${actor.type === 'INTEGRATION' ? actor.tokenId : ''}, true),
        set_config('app.org_id', ${actor.organizationId ?? ''}, true),
        set_config('app.request_id', ${requestId}, true)
    `;
    await tx`set local role app_user`;
    return fn(tx);
  }) as Promise<T>;
}

/**
 * Transação de SISTEMA (sem RLS): worker, webhooks, bootstrap de identidade,
 * rate limit. Uso sempre explícito; o chamador é responsável por filtrar por
 * organização e validar vínculos.
 */
export async function withSystemTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const sql = getSql();
  return sql.begin(async (tx) => {
    await tx`select set_config('app.actor_type', 'SYSTEM', true)`;
    return fn(tx);
  }) as Promise<T>;
}

/** Código SQLSTATE de violação de unicidade. */
export const UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; constraint_name?: string };
  return e.code === UNIQUE_VIOLATION && (constraint === undefined || e.constraint_name === constraint);
}
