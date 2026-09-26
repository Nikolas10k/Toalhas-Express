import { beforeAll, describe, expect, it } from 'vitest';
import { withActorTransaction } from '@/server/db/transaction';
import { recordAudit } from '@/server/modules/audit/audit.service';
import { createIntegrationToken, createOrg, createUserInOrg, sql } from './fixtures';

let orgA: string;
let orgB: string;
let adminA: { userId: string; memberId: string };
let adminB: { userId: string; memberId: string };
let driverA: { userId: string; memberId: string };

beforeAll(async () => {
  orgA = await createOrg('a');
  orgB = await createOrg('b');
  adminA = await createUserInOrg(orgA, ['ADMIN'], 'Admin A');
  adminB = await createUserInOrg(orgB, ['ADMIN'], 'Admin B');
  driverA = await createUserInOrg(orgA, ['DRIVER'], 'Motorista A');
  await withActorTransaction({ type: 'USER', userId: adminB.userId, organizationId: orgB }, (tx) =>
    recordAudit(tx, { type: 'USER', userId: adminB.userId }, orgB, { action: 'test.created', entityType: 'test' }),
  );
});

describe('isolamento entre organizações (RLS)', () => {
  it('admin da org A não vê roles, membros nem auditoria da org B', async () => {
    const result = await withActorTransaction({ type: 'USER', userId: adminA.userId, organizationId: orgA }, async (tx) => ({
      roles: await tx`select organization_id from public.roles`,
      members: await tx`select organization_id from public.organization_members`,
      audit: await tx`select organization_id from public.audit_logs`,
      orgs: await tx`select id from public.organizations`,
    }));
    for (const rows of Object.values(result)) {
      for (const r of rows as unknown as Record<string, string>[]) {
        expect(Object.values(r)[0]).toBe(orgA);
      }
    }
    expect(result.roles.length).toBeGreaterThan(0);
  });

  it('trocar a org ativa para uma da qual não é membro não retorna nada (defesa contra IDOR/BOLA)', async () => {
    const result = await withActorTransaction({ type: 'USER', userId: adminA.userId, organizationId: orgB }, async (tx) => ({
      roles: await tx`select id from public.roles`,
      audit: await tx`select id from public.audit_logs`,
      orgs: await tx`select id from public.organizations`,
      perms: await tx<{ p: string[] }[]>`select app.current_permissions() as p`,
    }));
    expect(result.roles).toHaveLength(0);
    expect(result.audit).toHaveLength(0);
    expect(result.orgs).toHaveLength(0);
    expect(result.perms[0]!.p).toEqual([]);
  });

  it('busca por ID de outra org retorna vazio mesmo sem filtro de organização', async () => {
    const [roleB] = await sql<{ id: string }[]>`select id from public.roles where organization_id = ${orgB} limit 1`;
    const rows = await withActorTransaction({ type: 'USER', userId: adminA.userId, organizationId: orgA }, (tx) =>
      tx`select * from public.roles where id = ${roleB!.id}`,
    );
    expect(rows).toHaveLength(0);
  });

  it('não é possível inserir dados em outra organização', async () => {
    await expect(
      withActorTransaction({ type: 'USER', userId: adminA.userId, organizationId: orgA }, (tx) =>
        tx`insert into public.outbox_events (id, organization_id, event_type, aggregate_type, aggregate_id, idempotency_key)
           values (gen_random_uuid(), ${orgB}, 'TestEvent', 'test', '1', 'rls-cross-org')`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('motorista não lê auditoria nem membros de terceiros', async () => {
    const result = await withActorTransaction({ type: 'USER', userId: driverA.userId, organizationId: orgA }, async (tx) => ({
      audit: await tx`select id from public.audit_logs`,
      members: await tx<{ user_id: string }[]>`select user_id from public.organization_members`,
      tokens: await tx`select id from public.integration_tokens`,
    }));
    expect(result.audit).toHaveLength(0);
    expect(result.members.map((m) => m.user_id)).toEqual([driverA.userId]);
    expect(result.tokens).toHaveLength(0);
  });

  it('motorista não consegue se promover a admin', async () => {
    await expect(
      withActorTransaction({ type: 'USER', userId: driverA.userId, organizationId: orgA }, (tx) =>
        tx`insert into public.member_roles (organization_id, member_id, role_id)
           select ${orgA}, ${driverA.memberId}, id from public.roles where organization_id = ${orgA} and code = 'ADMIN'`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('usuário suspenso perde todas as permissões', async () => {
    const u = await createUserInOrg(orgA, ['MANAGER']);
    await sql`update public.organization_members set status = 'suspended' where id = ${u.memberId}`;
    const [row] = await withActorTransaction({ type: 'USER', userId: u.userId, organizationId: orgA }, (tx) =>
      tx<{ p: string[] }[]>`select app.current_permissions() as p`,
    );
    expect(row!.p).toEqual([]);
  });

  it('token de integração só enxerga a própria organização e perde acesso quando revogado', async () => {
    const { tokenId } = await createIntegrationToken(orgA);
    const [ok] = await withActorTransaction({ type: 'INTEGRATION', tokenId, organizationId: orgA }, (tx) =>
      tx<{ p: string[] }[]>`select app.current_permissions() as p`,
    );
    expect(ok!.p.sort()).toEqual(['jobs.run', 'notifications.callback', 'order.create_draft']);
    const [cross] = await withActorTransaction({ type: 'INTEGRATION', tokenId, organizationId: orgB }, (tx) =>
      tx<{ p: string[] }[]>`select app.current_permissions() as p`,
    );
    expect(cross!.p).toEqual([]);
    await sql`update public.integration_tokens set revoked_at = now() where id = ${tokenId}`;
    const [revoked] = await withActorTransaction({ type: 'INTEGRATION', tokenId, organizationId: orgA }, (tx) =>
      tx<{ p: string[] }[]>`select app.current_permissions() as p`,
    );
    expect(revoked!.p).toEqual([]);
  });
});

describe('jobs e outbox para app_user', () => {
  it('app_user só enxerga a coluna idempotency_key de jobs/outbox', async () => {
    await expect(
      withActorTransaction({ type: 'USER', userId: adminA.userId, organizationId: orgA }, (tx) =>
        tx`select payload from public.outbox_events`,
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
