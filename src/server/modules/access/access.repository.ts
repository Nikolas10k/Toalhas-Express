import 'server-only';
import type { Tx } from '@/server/db/client';

export interface OwnMembershipRow {
  member_id: string;
  organization_id: string;
  status: string;
  mfa_required: boolean;
  created_at: Date;
}

/** Vínculos do usuário atual (RLS: só as próprias linhas). */
export async function listOwnMemberships(tx: Tx): Promise<OwnMembershipRow[]> {
  return tx<OwnMembershipRow[]>`
    select m.id as member_id,
           m.organization_id,
           m.status,
           m.mfa_required,
           m.created_at
    from public.organization_members m
    where m.user_id = app.current_user_id()
      and m.status = 'active'
    order by m.created_at asc, m.id asc
  `;
}

export interface ActorAccessRow {
  organization_name: string;
  permissions: string[];
  roles: string[];
  mfa_required: boolean;
}

/** Permissões efetivas na org ativa — exatamente as mesmas usadas pelo RLS. */
export async function loadCurrentAccess(tx: Tx, memberId: string | null): Promise<ActorAccessRow | null> {
  const rows = await tx<ActorAccessRow[]>`
    select o.name as organization_name,
           app.current_permissions() as permissions,
           coalesce((
             select array_agg(r.code order by r.code)
             from public.member_roles mr
             join public.roles r on r.id = mr.role_id
             where mr.member_id = ${memberId}
           ), '{}') as roles,
           coalesce((
             select bool_or(r.mfa_required)
             from public.member_roles mr
             join public.roles r on r.id = mr.role_id
             where mr.member_id = ${memberId}
           ), false) as mfa_required
    from public.organizations o
    where o.id = app.current_org_id()
  `;
  return rows[0] ?? null;
}

export interface IntegrationTokenRow {
  id: string;
  organization_id: string;
  name: string;
  token_hash: string;
  revoked_at: Date | null;
  expires_at: Date | null;
}

/** Lookup de token (contexto de sistema: ainda não há ator). */
export async function findIntegrationTokenByPrefix(tx: Tx, prefix: string): Promise<IntegrationTokenRow | null> {
  const rows = await tx<IntegrationTokenRow[]>`
    select t.id, t.organization_id, t.name, t.token_hash, t.revoked_at, t.expires_at
    from public.integration_tokens t
    join public.organizations o on o.id = t.organization_id
    where t.token_prefix = ${prefix}
      and o.status = 'active'
      and o.deleted_at is null
  `;
  return rows[0] ?? null;
}

export async function touchIntegrationToken(tx: Tx, tokenId: string): Promise<void> {
  await tx`
    update public.integration_tokens
       set last_used_at = now()
     where id = ${tokenId}
       and (last_used_at is null or last_used_at < now() - interval '1 minute')
  `;
}
