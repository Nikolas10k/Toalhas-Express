import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { toDbContext, type AuthenticatedActor } from '@/server/auth/actor';
import { stableHash } from '@/server/core/crypto';
import { ConflictError, ValidationError } from '@/server/core/errors';
import type { Tx } from '@/server/db/client';
import { isUniqueViolation, withActorTransaction } from '@/server/db/transaction';

export const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9:._-]+$/, 'Idempotency-Key inválida');

export interface IdempotentCommand<TRequest> {
  /** Escopo do comando, ex.: finance.create_charge */
  scope: string;
  key: string;
  /** Intenção enviada pelo cliente — usada para detectar reuso indevido da chave. */
  request: TRequest;
}

export interface IdempotentResult<T> {
  result: T;
  replayed: boolean;
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

interface StoredKey {
  request_hash: string;
  response: JsonValue;
}

async function findKey(tx: Tx, organizationId: string, scope: string, key: string): Promise<StoredKey | null> {
  const rows = await tx<StoredKey[]>`
    select request_hash, response
    from public.idempotency_keys
    where organization_id = ${organizationId} and scope = ${scope} and key = ${key}
  `;
  return rows[0] ?? null;
}

function replay<T>(stored: StoredKey, requestHash: string): IdempotentResult<T> {
  if (stored.request_hash !== requestHash) {
    throw new ConflictError('Esta chave de idempotência já foi usada com outros dados.');
  }
  return { result: stored.response as T, replayed: true };
}

/**
 * Executa um comando exatamente uma vez por (organização, escopo, chave).
 *
 * A chave é gravada na MESMA transação do comando. Duas requisições
 * simultâneas com a mesma chave: a segunda bloqueia no índice único até a
 * primeira confirmar, falha com unique_violation, a transação dela é desfeita
 * por inteiro e a resposta armazenada é devolvida. Nada é duplicado.
 */
export async function executeIdempotent<TRequest, T extends JsonValue>(
  actor: AuthenticatedActor,
  command: IdempotentCommand<TRequest>,
  fn: (tx: Tx) => Promise<T>,
): Promise<IdempotentResult<T>> {
  const parsedKey = idempotencyKeySchema.safeParse(command.key);
  if (!parsedKey.success) {
    throw new ValidationError('Idempotency-Key inválida.', [{ path: 'Idempotency-Key', message: 'formato inválido' }]);
  }
  const requestHash = stableHash(command.request);
  const orgId = actor.organizationId;
  const db = toDbContext(actor);

  try {
    return await withActorTransaction(db, async (tx) => {
      const existing = await findKey(tx, orgId, command.scope, command.key);
      if (existing) return replay<T>(existing, requestHash);

      const result = await fn(tx);
      await tx`
        insert into public.idempotency_keys (id, organization_id, scope, key, request_hash, actor_id, response)
        values (${randomUUID()}, ${orgId}, ${command.scope}, ${command.key}, ${requestHash},
                ${actor.type === 'USER' ? actor.userId : actor.tokenId}, ${tx.json(result as never)})
      `;
      return { result, replayed: false };
    });
  } catch (err) {
    if (!isUniqueViolation(err, 'idempotency_keys_organization_id_scope_key_key')) throw err;
    const stored = await withActorTransaction(db, (tx) => findKey(tx, orgId, command.scope, command.key));
    if (!stored) throw err;
    return replay<T>(stored, requestHash);
  }
}
