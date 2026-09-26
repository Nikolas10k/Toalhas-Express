import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@/server/authz/permissions';
import { resolveIntegrationActor, resolveUserActor } from '@/server/modules/access/access.service';
import { addMember, createIntegrationToken, createOrg, createUser, createUserInOrg, sql } from './fixtures';

describe('resolução do ator', () => {
  it('admin recebe todas as permissões e MFA obrigatório', async () => {
    const org = await createOrg('acc');
    const { userId } = await createUserInOrg(org, ['ADMIN']);
    const actor = await resolveUserActor({ userId, aal: 'aal1' });
    expect(actor?.organizationId).toBe(org);
    expect(actor?.roles).toEqual(['ADMIN']);
    expect(actor?.permissions.size).toBe(PERMISSIONS.length);
    expect(actor?.mfa).toEqual({ aal: 'aal1', lastTotpAt: undefined, required: true });
  });

  it('cliente só tem portal.access e MFA opcional', async () => {
    const org = await createOrg('acc');
    const { userId } = await createUserInOrg(org, ['CUSTOMER']);
    const actor = await resolveUserActor({ userId, aal: 'aal1' });
    expect([...actor!.permissions]).toEqual(['portal.access']);
    expect(actor!.mfa.required).toBe(false);
  });

  it('org preferida só vale se houver vínculo; senão usa a primeira', async () => {
    const orgA = await createOrg('pa');
    const orgB = await createOrg('pb');
    const orgC = await createOrg('pc');
    const userId = await createUser();
    await addMember(orgA, userId, ['MANAGER']);
    await addMember(orgB, userId, ['DRIVER']);
    expect((await resolveUserActor({ userId, aal: 'aal1' }, orgB))?.organizationId).toBe(orgB);
    expect((await resolveUserActor({ userId, aal: 'aal1' }, orgC))?.organizationId).toBe(orgA);
  });

  it('usuário sem vínculo ativo não vira ator', async () => {
    const org = await createOrg('acc');
    const userId = await createUser();
    expect(await resolveUserActor({ userId, aal: 'aal1' })).toBeNull();
    await addMember(org, userId, ['ADMIN'], { status: 'suspended' });
    expect(await resolveUserActor({ userId, aal: 'aal1' })).toBeNull();
  });

  it('organização suspensa bloqueia acesso', async () => {
    const org = await createOrg('susp');
    const { userId } = await createUserInOrg(org, ['ADMIN']);
    await sql`update public.organizations set status = 'suspended' where id = ${org}`;
    const actor = await resolveUserActor({ userId, aal: 'aal2' });
    expect(actor === null || actor.permissions.size === 0).toBe(true);
  });

  it('token de integração: válido, segredo errado, revogado e expirado', async () => {
    const org = await createOrg('tok');
    const { token, tokenId } = await createIntegrationToken(org);
    const actor = await resolveIntegrationActor(token);
    expect(actor).toMatchObject({ type: 'INTEGRATION', tokenId, organizationId: org });
    expect([...actor!.permissions].sort()).toEqual(['jobs.run', 'notifications.callback', 'order.create_draft']);

    expect(await resolveIntegrationActor(token.slice(0, -2) + 'xx')).toBeNull();
    expect(await resolveIntegrationActor('txi_invalido')).toBeNull();

    const revoked = await createIntegrationToken(org, { revoked: true });
    expect(await resolveIntegrationActor(revoked.token)).toBeNull();
    const expired = await createIntegrationToken(org, { expiresAt: new Date(Date.now() - 1000) });
    expect(await resolveIntegrationActor(expired.token)).toBeNull();
  });
});
