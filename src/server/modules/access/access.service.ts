import 'server-only';
import type { IntegrationActor, UserActor, AuthenticatedActor } from '@/server/auth/actor';
import { toDbContext } from '@/server/auth/actor';
import type { SessionClaims } from '@/server/auth/claims';
import { authorize } from '@/server/authz/authorize';
import { isPermission, type Permission } from '@/server/authz/permissions';
import { safeEqual, sha256Hex } from '@/server/core/crypto';
import { withActorTransaction, withSystemTransaction } from '@/server/db/transaction';
import {
  findIntegrationTokenByPrefix,
  listOwnMemberships,
  loadCurrentAccess,
  touchIntegrationToken,
} from './access.repository';
import * as adminRepo from './access.admin.repository';

function toPermissionSet(values: readonly string[]): ReadonlySet<Permission> {
  return new Set(values.filter(isPermission));
}

/**
 * Monta o ator a partir do JWT verificado. A organização ativa só é aceita se
 * o usuário tiver vínculo ativo com ela (cookie adulterado cai no padrão).
 */
export async function resolveUserActor(claims: SessionClaims, preferredOrgId?: string | null): Promise<UserActor | null> {
  const memberships = await withActorTransaction(
    { type: 'USER', userId: claims.userId, organizationId: null },
    (tx) => listOwnMemberships(tx),
  );
  if (memberships.length === 0) return null;
  const membership = memberships.find((m) => m.organization_id === preferredOrgId) ?? memberships[0]!;

  const access = await withActorTransaction(
    { type: 'USER', userId: claims.userId, organizationId: membership.organization_id },
    (tx) => loadCurrentAccess(tx, membership.member_id),
  );
  if (!access) return null;

  return {
    type: 'USER',
    userId: claims.userId,
    email: claims.email,
    organizationId: membership.organization_id,
    memberId: membership.member_id,
    roles: access.roles,
    permissions: toPermissionSet(access.permissions),
    mfa: {
      aal: claims.aal,
      lastTotpAt: claims.lastTotpAt,
      required: membership.mfa_required || access.mfa_required,
    },
  };
}

/** Formato: txi_<prefixo 8>_<segredo>. Só o SHA-256 do token inteiro fica no banco. */
const TOKEN_RE = /^txi_([a-z0-9]{8})_([A-Za-z0-9_-]{32,128})$/;

export async function resolveIntegrationActor(rawToken: string): Promise<IntegrationActor | null> {
  const match = TOKEN_RE.exec(rawToken);
  if (!match) return null;
  const prefix = match[1]!;
  const hash = sha256Hex(rawToken);

  const token = await withSystemTransaction(async (tx) => {
    const row = await findIntegrationTokenByPrefix(tx, prefix);
    if (!row || !safeEqual(row.token_hash, hash)) return null;
    if (row.revoked_at || (row.expires_at && row.expires_at.getTime() <= Date.now())) return null;
    await touchIntegrationToken(tx, row.id);
    return row;
  });
  if (!token) return null;

  const access = await withActorTransaction(
    { type: 'INTEGRATION', tokenId: token.id, organizationId: token.organization_id },
    (tx) => loadCurrentAccess(tx, null),
  );
  if (!access) return null;

  return {
    type: 'INTEGRATION',
    tokenId: token.id,
    name: token.name,
    organizationId: token.organization_id,
    permissions: toPermissionSet(access.permissions),
  };
}

// -----------------------------------------------------------------------------
// Consultas administrativas (Administração → Usuários / Permissões)
// -----------------------------------------------------------------------------

export async function listMembers(actor: AuthenticatedActor) {
  authorize(actor, 'users.read');
  return withActorTransaction(toDbContext(actor), (tx) => adminRepo.listMembers(tx));
}

export async function listRolesWithPermissions(actor: AuthenticatedActor) {
  authorize(actor, 'users.read');
  return withActorTransaction(toDbContext(actor), async (tx) => ({
    roles: await adminRepo.listRoles(tx),
    permissions: await adminRepo.listPermissions(tx),
  }));
}
