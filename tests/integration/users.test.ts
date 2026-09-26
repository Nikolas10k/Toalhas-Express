import { beforeAll, describe, expect, it } from 'vitest';
import type { UserActor } from '@/server/auth/actor';
import { AuthorizationError, BusinessRuleError, StepUpRequiredError } from '@/server/core/errors';
import { resolveUserActor } from '@/server/modules/access/access.service';
import { setMemberRoles, setMemberStatus } from '@/server/modules/users/users.service';
import { createOrg, createUserInOrg, sql } from './fixtures';

let org: string;
let admin: UserActor;
let managerMember: string;
let manager: UserActor;

beforeAll(async () => {
  org = await createOrg('usr');
  const a = await createUserInOrg(org, ['ADMIN']);
  admin = (await resolveUserActor({ userId: a.userId, aal: 'aal2', lastTotpAt: Math.floor(Date.now() / 1000) }, org))!;
  const m = await createUserInOrg(org, ['MANAGER']);
  managerMember = m.memberId;
  manager = (await resolveUserActor({ userId: m.userId, aal: 'aal2', lastTotpAt: Math.floor(Date.now() / 1000) }, org))!;
});

describe('gestão de usuários', () => {
  it('admin suspende e reativa membro, com auditoria', async () => {
    await setMemberStatus(admin, managerMember, { status: 'suspended', reason: 'férias' });
    expect((await sql`select status from public.organization_members where id = ${managerMember}`)[0]?.status).toBe('suspended');
    await setMemberStatus(admin, managerMember, { status: 'active', reason: 'retorno' });
    const audits = await sql`select action from public.audit_logs where entity_id = ${managerMember}`;
    expect(audits).toHaveLength(2);
  });

  it('não permite suspender a si mesmo nem ficar sem administrador', async () => {
    await expect(setMemberStatus(admin, admin.memberId, { status: 'suspended', reason: 'x x x' })).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(setMemberRoles(admin, admin.memberId, { roleCodes: ['MANAGER'] })).rejects.toThrow(/pelo menos um administrador/);
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.member_roles mr join public.roles r on r.id = mr.role_id
       where mr.member_id = ${admin.memberId} and r.code = 'ADMIN'`;
    expect(row!.n).toBe(1);
  });

  it('gerente não altera perfis nem usuários; admin sem MFA recente precisa de step-up', async () => {
    await expect(setMemberRoles(manager, managerMember, { roleCodes: ['ADMIN'] })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(setMemberStatus(manager, admin.memberId, { status: 'suspended', reason: 'golpe' })).rejects.toBeInstanceOf(AuthorizationError);
    const stale: UserActor = { ...admin, mfa: { ...admin.mfa, lastTotpAt: 1 } };
    await expect(setMemberRoles(stale, managerMember, { roleCodes: ['DRIVER'] })).rejects.toBeInstanceOf(StepUpRequiredError);
  });

  it('admin altera perfis e perfil inexistente é rejeitado', async () => {
    await setMemberRoles(admin, managerMember, { roleCodes: ['MANAGER', 'DRIVER'] });
    await expect(setMemberRoles(admin, managerMember, { roleCodes: ['SUPERUSER'] })).rejects.toThrow(/Perfil de acesso inválido/);
  });
});
