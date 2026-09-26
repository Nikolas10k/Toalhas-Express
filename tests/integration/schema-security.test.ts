import { describe, expect, it } from 'vitest';
import { PERMISSIONS, STEP_UP_PERMISSIONS } from '@/server/authz/permissions';
import { createOrg, sql } from './fixtures';

describe('segurança do schema', () => {
  it('toda tabela de public tem RLS habilitado', async () => {
    const rows = await sql<{ relname: string; relrowsecurity: boolean }[]>`
      select c.relname, c.relrowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
    `;
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)).toEqual([]);
  });

  it('anon e authenticated (Data API do Supabase) não têm privilégio em nenhuma tabela', async () => {
    const rows = await sql<{ table_name: string; grantee: string; privilege_type: string }[]>`
      select table_name, grantee, privilege_type
      from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon', 'authenticated')
    `;
    expect(rows).toEqual([]);
  });

  it('anon e authenticated não executam funções do schema app', async () => {
    const rows = await sql<{ proname: string }[]>`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app'
        and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
    `;
    expect(rows).toEqual([]);
  });

  it('app_user não pode chamar funções administrativas', async () => {
    const rows = await sql<{ proname: string }[]>`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app'
        and p.proname in ('bootstrap_organization', 'claim_jobs', 'claim_outbox_events', 'rate_limit_hit')
        and has_function_privilege('app_user', p.oid, 'execute')
    `;
    expect(rows).toEqual([]);
  });

  it('catálogo de permissões do código é idêntico ao do banco', async () => {
    const rows = await sql<{ code: string; requires_step_up: boolean }[]>`select code, requires_step_up from public.permissions`;
    expect(rows.map((r) => r.code).sort()).toEqual([...PERMISSIONS].sort());
    expect(rows.filter((r) => r.requires_step_up).map((r) => r.code).sort()).toEqual([...STEP_UP_PERMISSIONS].sort());
  });

  it('roles padrão: motorista sem financeiro, cliente só portal, gerente sem estorno', async () => {
    const org = await createOrg('roles');
    const rows = await sql<{ code: string; perms: string[]; mfa_required: boolean }[]>`
      select r.code, r.mfa_required, array_agg(rp.permission_code order by rp.permission_code) as perms
      from public.roles r join public.role_permissions rp on rp.role_id = r.id
      where r.organization_id = ${org} group by r.code, r.mfa_required
    `;
    const byCode = Object.fromEntries(rows.map((r) => [r.code, r]));
    expect(byCode.ADMIN!.perms.length).toBe(PERMISSIONS.length);
    expect(byCode.ADMIN!.mfa_required).toBe(true);
    expect(byCode.DRIVER!.perms.some((p) => p.startsWith('finance.') || p.startsWith('contract.') || p.startsWith('reports.'))).toBe(false);
    expect(byCode.CUSTOMER!.perms).toEqual(['portal.access']);
    expect(byCode.MANAGER!.perms).not.toContain('finance.refund');
    expect(byCode.MANAGER!.perms).not.toContain('permissions.manage');
    expect(byCode.INTEGRATION!.perms.sort()).toEqual(['jobs.run', 'notifications.callback', 'order.create_draft']);
  });
});
