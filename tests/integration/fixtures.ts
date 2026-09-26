import { randomBytes, randomUUID } from 'node:crypto';
import { sha256Hex } from '@/server/core/crypto';
import { testSql as sql } from '../setup/integration';

export { sql };

export async function createOrg(label = 'org'): Promise<string> {
  const slug = `${label}-${randomUUID().slice(0, 8)}`;
  const [row] = await sql<{ id: string }[]>`select app.bootstrap_organization(${`Org ${label}`}, ${slug}) as id`;
  return row!.id;
}

export async function createUser(fullName = 'Usuário Teste'): Promise<string> {
  const id = randomUUID();
  await sql`insert into auth.users (id, email) values (${id}, ${`${id}@example.test`})`;
  await sql`insert into public.profiles (id, full_name) values (${id}, ${fullName})`;
  return id;
}

export async function addMember(
  orgId: string,
  userId: string,
  roleCodes: string[],
  opts: { status?: string; mfaRequired?: boolean } = {},
): Promise<string> {
  const memberId = randomUUID();
  await sql`
    insert into public.organization_members (id, organization_id, user_id, status, mfa_required)
    values (${memberId}, ${orgId}, ${userId}, ${opts.status ?? 'active'}, ${opts.mfaRequired ?? false})
  `;
  for (const code of roleCodes) {
    await sql`
      insert into public.member_roles (organization_id, member_id, role_id)
      select ${orgId}, ${memberId}, r.id from public.roles r where r.organization_id = ${orgId} and r.code = ${code}
    `;
  }
  return memberId;
}

export async function createUserInOrg(orgId: string, roles: string[], name?: string) {
  const userId = await createUser(name);
  const memberId = await addMember(orgId, userId, roles);
  return { userId, memberId };
}

export async function createIntegrationToken(
  orgId: string,
  opts: { revoked?: boolean; expiresAt?: Date; roleCode?: string } = {},
): Promise<{ token: string; tokenId: string }> {
  const prefix = randomBytes(8).toString('hex').slice(0, 8).replace(/[^a-z0-9]/g, 'a');
  const token = `txi_${prefix}_${randomBytes(32).toString('base64url')}`;
  const tokenId = randomUUID();
  await sql`
    insert into public.integration_tokens (id, organization_id, role_id, name, token_prefix, token_hash, revoked_at, expires_at)
    select ${tokenId}, ${orgId}, r.id, 'n8n teste', ${prefix}, ${sha256Hex(token)},
           ${opts.revoked ? new Date() : null}, ${opts.expiresAt ?? null}
    from public.roles r where r.organization_id = ${orgId} and r.code = ${opts.roleCode ?? 'INTEGRATION'}
  `;
  return { token, tokenId };
}
