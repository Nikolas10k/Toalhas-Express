import 'server-only';
import { createHash } from 'node:crypto';
import { toDbContext, type UserActor } from '@/server/auth/actor';
import { authorize, hasPermission } from '@/server/authz/authorize';
import { getServerEnv } from '@/server/core/env';
import { AuthorizationError, BusinessRuleError, NotFoundError, ValidationError } from '@/server/core/errors';
import type { Tx } from '@/server/db/client';
import { withActorTransaction } from '@/server/db/transaction';
import { hitRateLimit, RATE_LIMITS } from '@/server/modules/rate-limit/rate-limit.service';
import type { StorageProvider } from '@/server/providers/storage-provider';
import { SupabaseStorageProvider } from '@/server/providers/supabase-storage-provider';

export const PROOF_BUCKET = 'operation-proofs';
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_RECORD = 5;
const SIGNED_URL_TTL_SECONDS = 300;

let override: StorageProvider | null | undefined;

/** Sem service role configurada → null (upload indisponível; o resto funciona). */
export function getStorageProvider(): StorageProvider | null {
  if (override !== undefined) return override;
  const env = getServerEnv();
  return env.SUPABASE_SERVICE_ROLE_KEY ? new SupabaseStorageProvider(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY) : null;
}

/** Apenas para testes. */
export function setStorageProviderForTesting(p: StorageProvider | null | undefined): void {
  override = p;
}

/** Tipo real pelo conteúdo (magic bytes), nunca pela extensão ou pelo Content-Type enviado. */
export function detectImageType(data: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => data[i] === b)) return 'image/png';
  if (
    data.length >= 12 &&
    String.fromCharCode(...data.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...data.subarray(8, 12)) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export async function uploadPhoto(actor: UserActor, data: Uint8Array) {
  if (!['operation.execute', 'incident.report', 'incident.manage'].some((p) => hasPermission(actor, p as never))) {
    throw new AuthorizationError();
  }
  if (data.byteLength === 0) throw new ValidationError('Arquivo vazio.');
  if (data.byteLength > MAX_UPLOAD_BYTES) throw new ValidationError('Foto maior que 5 MB.');
  const contentType = detectImageType(data);
  if (!contentType) throw new ValidationError('Envie uma foto JPG, PNG ou WEBP.');
  await hitRateLimit(RATE_LIMITS.uploadByActor, actor.userId);
  const provider = getStorageProvider();
  if (!provider) throw new BusinessRuleError('Envio de fotos indisponível: armazenamento não configurado no servidor.');

  const month = new Date().toISOString().slice(0, 7);
  const stored = await provider.upload({ bucket: PROOF_BUCKET, data, contentType, prefix: `${actor.organizationId}/${month}` });
  const sha256 = createHash('sha256').update(data).digest('hex');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      insert into public.attachments (organization_id, bucket, path, content_type, size_bytes, sha256, uploaded_by)
      values (${actor.organizationId}, ${stored.bucket}, ${stored.path}, ${contentType}, ${stored.sizeBytes}, ${sha256}, ${actor.userId})
      returning id`;
    return { id: row!.id, contentType, sizeBytes: stored.sizeBytes };
  });
}

/**
 * Vincula anexos enviados pelo próprio ator (ainda soltos) a um registro.
 * Anexo de outra pessoa, já usado ou de outra org simplesmente não casa.
 */
export async function linkAttachments(tx: Tx, actor: UserActor, ids: string[], entityType: 'stop_operation' | 'incident', entityId: string) {
  if (ids.length === 0) return;
  const unique = [...new Set(ids)];
  if (unique.length > MAX_ATTACHMENTS_PER_RECORD) throw new ValidationError(`Envie no máximo ${MAX_ATTACHMENTS_PER_RECORD} fotos.`);
  const updated = await tx`
    update public.attachments set entity_type = ${entityType}, entity_id = ${entityId}
     where id = any (${unique}::uuid[]) and uploaded_by = ${actor.userId} and entity_id is null
       and organization_id = app.current_org_id()`;
  if (updated.count !== unique.length) throw new ValidationError('Foto inválida ou já utilizada. Envie de novo.');
}

export async function listAttachmentIds(tx: Tx, entityType: 'stop_operation' | 'incident', entityId: string) {
  return (await tx<{ id: string }[]>`
    select id from public.attachments where entity_type = ${entityType} and entity_id = ${entityId} order by created_at`).map((r) => r.id);
}

/** Link temporário (5 min) para ver a foto; RLS decide quem enxerga o anexo. */
export async function getAttachmentUrl(actor: UserActor, id: string) {
  authorize(actor, 'admin.access');
  const row = await withActorTransaction(toDbContext(actor), async (tx) => {
    const [a] = await tx<{ bucket: string; path: string }[]>`select bucket, path from public.attachments where id = ${id}`;
    return a;
  });
  if (!row) throw new NotFoundError('Foto não encontrada.');
  const provider = getStorageProvider();
  if (!provider) throw new BusinessRuleError('Armazenamento não configurado.');
  return { url: await provider.createSignedUrl(row.bucket, row.path, SIGNED_URL_TTL_SECONDS), expiresInSeconds: SIGNED_URL_TTL_SECONDS };
}
