import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/page-header';
import { requirePageActor } from '@/server/auth/guards';
import { listMembers, listRolesWithPermissions } from '@/server/modules/access/access.service';
import { UsersManager } from './users-manager';

export const metadata: Metadata = { title: 'Usuários' };

export default async function UsersPage() {
  const actor = await requirePageActor('users.read', '/admin/administracao/usuarios');
  const [members, { roles }] = await Promise.all([listMembers(actor), listRolesWithPermissions(actor)]);
  return (
    <>
      <PageHeader title="Usuários" description="Membros da organização e seus perfis de acesso. Alterações exigem confirmação com o autenticador." />
      <UsersManager
        currentUserId={actor.userId}
        members={members.map((m) => ({
          memberId: m.member_id,
          userId: m.user_id,
          fullName: m.full_name,
          status: m.status,
          roles: m.roles,
          createdAt: m.created_at.toISOString(),
        }))}
        roles={roles.filter((r) => r.code !== 'INTEGRATION').map((r) => ({ code: r.code, name: r.name }))}
        can={{ manage: actor.permissions.has('users.manage'), roles: actor.permissions.has('permissions.manage') }}
      />
    </>
  );
}
