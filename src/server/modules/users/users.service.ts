import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { toDbContext, type UserActor } from '@/server/auth/actor';
import { authorize } from '@/server/authz/authorize';
import { BusinessRuleError, NotFoundError, ProviderError } from '@/server/core/errors';
import { getServerEnv } from '@/server/core/env';
import type { Tx } from '@/server/db/client';
import { withActorTransaction, withSystemTransaction } from '@/server/db/transaction';
import { recordAudit } from '@/server/modules/audit/audit.service';
import { findCustomerById, linkCustomerUser } from '@/server/modules/customers/customers.repository';
import { createSupabaseAdminClient } from '@/server/supabase/admin';

const roleCode = z.string().regex(/^[A-Z][A-Z0-9_]{1,49}$/);

export const inviteMemberSchema = z.strictObject({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email({ message: 'E-mail inválido.' })),
  fullName: z.string().trim().min(2).max(150),
  roleCodes: z.array(roleCode).min(1).max(5),
});
export const memberStatusSchema = z.strictObject({
  status: z.enum(['active', 'suspended']),
  reason: z.string().trim().min(3).max(300),
});
export const memberRolesSchema = z.strictObject({ roleCodes: z.array(roleCode).min(1).max(5) });
export const portalInviteSchema = z.strictObject({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email({ message: 'E-mail inválido.' })),
  fullName: z.string().trim().min(2).max(150),
});

/**
 * Convida (ou reaproveita) um usuário no Supabase Auth. Exige a service role
 * key no servidor; sem ela, a operação é recusada com mensagem clara.
 */
async function ensureAuthUser(email: string): Promise<string> {
  if (!getServerEnv().SUPABASE_SERVICE_ROLE_KEY) {
    throw new BusinessRuleError(
      'Convites exigem a variável SUPABASE_SERVICE_ROLE_KEY configurada no servidor (ver docs/DEPLOYMENT.md).',
    );
  }
  const existing = await withSystemTransaction(
    (tx) => tx<{ id: string }[]>`select id from auth.users where lower(email) = ${email}`,
  );
  if (existing[0]) return existing[0].id;
  const admin = createSupabaseAdminClient();
  const redirectTo = new URL('/auth/confirm?next=/redefinir-senha', getServerEnv().APP_URL).toString();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
  if (error || !data.user) throw new ProviderError('supabase_admin', `Falha ao convidar: ${error?.status ?? 'sem usuário'}`);
  return data.user.id;
}

async function ensureProfile(userId: string, fullName: string) {
  // Perfis são criados em contexto de sistema (bootstrap de identidade).
  await withSystemTransaction(
    (tx) => tx`insert into public.profiles (id, full_name) values (${userId}, ${fullName}) on conflict (id) do nothing`,
  );
}

async function roleIds(tx: Tx, codes: string[]): Promise<{ id: string; code: string }[]> {
  const rows = await tx<{ id: string; code: string }[]>`
    select id, code from public.roles where organization_id = app.current_org_id() and code = any (${codes})
  `;
  if (rows.length !== new Set(codes).size) throw new BusinessRuleError('Perfil de acesso inválido.');
  return rows;
}

export async function inviteMember(actor: UserActor, input: z.infer<typeof inviteMemberSchema>) {
  authorize(actor, 'users.manage');
  authorize(actor, 'permissions.manage');
  const userId = await ensureAuthUser(input.email);
  await ensureProfile(userId, input.fullName);
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const exists = await tx`select 1 from public.organization_members where organization_id = app.current_org_id() and user_id = ${userId}`;
    if (exists.length) throw new BusinessRuleError('Este usuário já faz parte da organização.');
    const roles = await roleIds(tx, input.roleCodes);
    const memberId = randomUUID();
    await tx`insert into public.organization_members (id, organization_id, user_id, status) values (${memberId}, ${actor.organizationId}, ${userId}, 'active')`;
    for (const r of roles) {
      await tx`insert into public.member_roles (organization_id, member_id, role_id) values (${actor.organizationId}, ${memberId}, ${r.id})`;
    }
    await recordAudit(tx, actor, actor.organizationId, {
      action: 'member.invited',
      entityType: 'organization_member',
      entityId: memberId,
      after: { user_id: userId, roles: input.roleCodes },
    });
    return { memberId };
  });
}

async function countActiveAdmins(tx: Tx): Promise<number> {
  const [row] = await tx<{ n: number }[]>`
    select count(distinct m.id)::int as n
      from public.organization_members m
      join public.member_roles mr on mr.member_id = m.id
      join public.roles r on r.id = mr.role_id
     where m.organization_id = app.current_org_id() and m.status = 'active' and r.code = 'ADMIN'
  `;
  return row?.n ?? 0;
}

async function loadMember(tx: Tx, memberId: string) {
  // Lock primeiro (FOR UPDATE não combina com GROUP BY), depois os perfis.
  const [m] = await tx<{ id: string; user_id: string; status: string }[]>`
    select id, user_id, status from public.organization_members
     where id = ${memberId} and organization_id = app.current_org_id()
     for update
  `;
  if (!m) throw new NotFoundError('Usuário não encontrado.');
  const roles = await tx<{ code: string }[]>`
    select r.code from public.member_roles mr join public.roles r on r.id = mr.role_id where mr.member_id = ${memberId}
  `;
  return { ...m, roles: roles.map((r) => r.code) };
}

export async function setMemberStatus(actor: UserActor, memberId: string, input: z.infer<typeof memberStatusSchema>) {
  authorize(actor, 'users.manage');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const m = await loadMember(tx, memberId);
    if (m.user_id === actor.userId) throw new BusinessRuleError('Você não pode alterar o próprio status.');
    if (m.status === input.status) return { status: m.status };
    await tx`update public.organization_members set status = ${input.status} where id = ${memberId}`;
    if (m.roles.includes('ADMIN') && (await countActiveAdmins(tx)) === 0) {
      throw new BusinessRuleError('A organização precisa de pelo menos um administrador ativo.');
    }
    await recordAudit(tx, actor, actor.organizationId, {
      action: 'member.status_changed',
      entityType: 'organization_member',
      entityId: memberId,
      before: { status: m.status },
      after: { status: input.status },
      metadata: { reason: input.reason },
    });
    return { status: input.status };
  });
}

export async function setMemberRoles(actor: UserActor, memberId: string, input: z.infer<typeof memberRolesSchema>) {
  authorize(actor, 'permissions.manage');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const m = await loadMember(tx, memberId);
    const roles = await roleIds(tx, input.roleCodes);
    // Regra checada ANTES de alterar: nunca deixar a organização sem ADMIN ativo.
    const losesAdmin = m.roles.includes('ADMIN') && !input.roleCodes.includes('ADMIN') && m.status === 'active';
    if (losesAdmin && (await countActiveAdmins(tx)) <= 1) {
      throw new BusinessRuleError('A organização precisa de pelo menos um administrador ativo.');
    }
    // Insere os novos antes de remover os antigos (o ator pode estar alterando o próprio perfil).
    for (const r of roles) {
      await tx`insert into public.member_roles (organization_id, member_id, role_id) values (${actor.organizationId}, ${memberId}, ${r.id}) on conflict do nothing`;
    }
    await tx`
      delete from public.member_roles
       where member_id = ${memberId} and organization_id = app.current_org_id()
         and role_id <> all (${roles.map((r) => r.id)}::uuid[])
    `;
    await recordAudit(tx, actor, actor.organizationId, {
      action: 'member.roles_changed',
      entityType: 'organization_member',
      entityId: memberId,
      before: { roles: m.roles },
      after: { roles: input.roleCodes },
    });
    return { roles: input.roleCodes };
  });
}

/** Dá acesso ao portal para um contato do cliente (perfil CUSTOMER + vínculo). */
export async function inviteCustomerPortalUser(actor: UserActor, customerId: string, input: z.infer<typeof portalInviteSchema>) {
  authorize(actor, 'users.manage');
  authorize(actor, 'customer.update');
  // Valida o cliente ANTES de criar qualquer usuário no Auth.
  await withActorTransaction(toDbContext(actor), async (tx) => {
    const c = await findCustomerById(tx, customerId);
    if (!c) throw new NotFoundError('Cliente não encontrado.');
    if (c.anonymizedAt) throw new BusinessRuleError('Cliente anonimizado.');
  });
  const userId = await ensureAuthUser(input.email);
  await ensureProfile(userId, input.fullName);
  // Vínculo com perfil CUSTOMER (sem nenhuma permissão interna): operação de
  // sistema estreita, liberada pela autorização explícita acima.
  await withSystemTransaction(async (tx) => {
    const [member] = await tx<{ id: string }[]>`
      insert into public.organization_members (organization_id, user_id, status)
      values (${actor.organizationId}, ${userId}, 'active')
      on conflict (organization_id, user_id) do update set updated_at = now()
      returning id
    `;
    await tx`
      insert into public.member_roles (organization_id, member_id, role_id)
      select ${actor.organizationId}, ${member!.id}, r.id from public.roles r
       where r.organization_id = ${actor.organizationId} and r.code = 'CUSTOMER'
      on conflict do nothing
    `;
  });
  return withActorTransaction(toDbContext(actor), async (tx) => {
    await linkCustomerUser(tx, actor.organizationId, customerId, userId);
    await recordAudit(tx, actor, actor.organizationId, {
      action: 'customer.portal_user_invited',
      entityType: 'customer',
      entityId: customerId,
      after: { user_id: userId },
    });
    return { userId };
  });
}
