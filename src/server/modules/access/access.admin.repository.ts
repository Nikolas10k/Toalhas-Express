import 'server-only';
import type { Tx } from '@/server/db/client';

export interface MemberListItem {
  member_id: string;
  user_id: string;
  full_name: string | null;
  status: string;
  mfa_required: boolean;
  roles: string[];
  created_at: Date;
}

// Todas as consultas rodam com RLS (org ativa). O filtro explícito por
// organização é redundante de propósito: defesa em profundidade.
export async function listMembers(tx: Tx): Promise<MemberListItem[]> {
  return tx<MemberListItem[]>`
    select m.id as member_id,
           m.user_id,
           p.full_name,
           m.status,
           m.mfa_required,
           coalesce(array_agg(r.code order by r.code) filter (where r.code is not null), '{}') as roles,
           m.created_at
    from public.organization_members m
    left join public.profiles p on p.id = m.user_id
    left join public.member_roles mr on mr.member_id = m.id
    left join public.roles r on r.id = mr.role_id
    where m.organization_id = app.current_org_id()
    group by m.id, p.full_name
    order by m.created_at asc
    limit 500
  `;
}

export interface RoleWithPermissions {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_system: boolean;
  mfa_required: boolean;
  permissions: string[];
}

export async function listRoles(tx: Tx): Promise<RoleWithPermissions[]> {
  return tx<RoleWithPermissions[]>`
    select r.id, r.code, r.name, r.description, r.is_system, r.mfa_required,
           coalesce(array_agg(rp.permission_code order by rp.permission_code)
                    filter (where rp.permission_code is not null), '{}') as permissions
    from public.roles r
    left join public.role_permissions rp on rp.role_id = r.id
    where r.organization_id = app.current_org_id()
    group by r.id
    order by r.is_system desc, r.code
  `;
}

export interface PermissionRow {
  code: string;
  category: string;
  description: string;
  requires_step_up: boolean;
}

export async function listPermissions(tx: Tx): Promise<PermissionRow[]> {
  return tx<PermissionRow[]>`
    select code, category, description, requires_step_up
    from public.permissions
    order by category, code
  `;
}
