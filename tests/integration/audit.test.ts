import { beforeAll, describe, expect, it } from 'vitest';
import type { UserActor } from '@/server/auth/actor';
import { AuthorizationError } from '@/server/core/errors';
import { createRequestContext, runWithRequestContext } from '@/server/core/request-context';
import { withActorTransaction } from '@/server/db/transaction';
import { resolveUserActor } from '@/server/modules/access/access.service';
import { listAuditLogsForActor, recordAudit } from '@/server/modules/audit/audit.service';
import { createOrg, createUserInOrg, sql } from './fixtures';

let org: string;
let admin: UserActor;
let managerUserId: string;

beforeAll(async () => {
  org = await createOrg('audit');
  const a = await createUserInOrg(org, ['ADMIN']);
  admin = (await resolveUserActor({ userId: a.userId, aal: 'aal2' }))!;
  managerUserId = (await createUserInOrg(org, ['MANAGER'])).userId;
});

describe('audit_logs', () => {
  it('grava contexto da requisição e mascara campos sensíveis', async () => {
    const ctx = createRequestContext({ ip: '203.0.113.9', userAgent: 'vitest', correlationId: 'corr-12345678' });
    await runWithRequestContext(ctx, () =>
      withActorTransaction({ type: 'USER', userId: admin.userId, organizationId: org }, (tx) =>
        recordAudit(tx, admin, org, {
          action: 'customer.updated',
          entityType: 'customer',
          entityId: 'c-1',
          before: { name: 'A', password: 'x' },
          after: { name: 'B', api_token: 'y' },
        }),
      ),
    );
    const [row] = await sql<Record<string, unknown>[]>`
      select actor_type, actor_id, before, after, host(ip) as ip, user_agent, request_id, correlation_id
      from public.audit_logs where organization_id = ${org} and action = 'customer.updated'
    `;
    expect(row).toMatchObject({
      actor_type: 'USER',
      actor_id: admin.userId,
      before: { name: 'A', password: '[REDACTED]' },
      after: { name: 'B', api_token: '[REDACTED]' },
      ip: '203.0.113.9',
      user_agent: 'vitest',
      request_id: ctx.requestId,
      correlation_id: 'corr-12345678',
    });
  });

  it('é append-only: UPDATE, DELETE e TRUNCATE falham até para o dono das tabelas', async () => {
    await expect(sql`update public.audit_logs set action = 'x.y' where organization_id = ${org}`).rejects.toThrow(/append-only/);
    await expect(sql`delete from public.audit_logs where organization_id = ${org}`).rejects.toThrow(/append-only/);
    await expect(sql`truncate public.audit_logs`).rejects.toThrow(/append-only/);
  });

  it('ator não consegue gravar auditoria em nome de outro usuário', async () => {
    await expect(
      withActorTransaction({ type: 'USER', userId: admin.userId, organizationId: org }, (tx) =>
        recordAudit(tx, { type: 'USER', userId: managerUserId }, org, { action: 'spoof.attempt', entityType: 'test' }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('lista com paginação por cursor sem repetir nem pular registros', async () => {
    for (let i = 0; i < 7; i++) {
      await withActorTransaction({ type: 'USER', userId: admin.userId, organizationId: org }, (tx) =>
        recordAudit(tx, admin, org, { action: 'page.test', entityType: 'test', entityId: String(i) }),
      );
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listAuditLogsForActor(admin, { action: 'page.test', limit: 3, cursor });
      seen.push(...page.items.map((i) => i.entityId!));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual(['6', '5', '4', '3', '2', '1', '0']);
  });

  it('gerente sem audit.read não lista auditoria', async () => {
    const manager = (await resolveUserActor({ userId: managerUserId, aal: 'aal1' }))!;
    // MANAGER padrão tem audit.read; removemos para simular gerente restrito.
    const restricted: UserActor = { ...manager, permissions: new Set([...manager.permissions].filter((p) => p !== 'audit.read')) };
    await expect(listAuditLogsForActor(restricted, { limit: 10 })).rejects.toBeInstanceOf(AuthorizationError);
  });
});
