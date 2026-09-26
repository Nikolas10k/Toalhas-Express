import { describe, expect, it } from 'vitest';
import type { IntegrationActor, UserActor } from '@/server/auth/actor';
import { authorize } from '@/server/authz/authorize';
import { PERMISSIONS, type Permission } from '@/server/authz/permissions';
import { AuthorizationError, MfaRequiredError, StepUpRequiredError } from '@/server/core/errors';

const NOW = 1_800_000_000;

function user(perms: Permission[], mfa: Partial<UserActor['mfa']> = {}): UserActor {
  return {
    type: 'USER',
    userId: 'u',
    organizationId: 'o',
    memberId: 'm',
    roles: [],
    permissions: new Set(perms),
    mfa: { aal: 'aal1', required: false, ...mfa },
  };
}

describe('authorize', () => {
  it('permite quem tem a permissão e nega quem não tem', () => {
    expect(() => authorize(user(['customer.read']), 'customer.read')).not.toThrow();
    expect(() => authorize(user(['customer.read']), 'finance.read')).toThrow(AuthorizationError);
  });

  it('exige AAL2 quando o perfil exige MFA', () => {
    const a = user([...PERMISSIONS], { required: true, aal: 'aal1' });
    expect(() => authorize(a, 'customer.read')).toThrow(MfaRequiredError);
  });

  it('gerente sem finance.refund não estorna, mesmo com MFA recente', () => {
    const manager = user(['finance.read', 'finance.create_charge'], { aal: 'aal2', lastTotpAt: NOW });
    expect(() => authorize(manager, 'finance.refund', { nowSeconds: NOW })).toThrow(AuthorizationError);
  });

  it('estorno exige step-up (TOTP recente)', () => {
    const admin = user(['finance.refund'], { aal: 'aal2', lastTotpAt: NOW - 3600, required: true });
    expect(() => authorize(admin, 'finance.refund', { nowSeconds: NOW })).toThrow(StepUpRequiredError);
    const fresh = user(['finance.refund'], { aal: 'aal2', lastTotpAt: NOW - 30, required: true });
    expect(() => authorize(fresh, 'finance.refund', { nowSeconds: NOW })).not.toThrow();
  });

  it('motorista não acessa nada financeiro', () => {
    const driver = user(['driver_app.access', 'operation.execute', 'incident.report']);
    for (const p of PERMISSIONS.filter((p) => p.startsWith('finance.'))) {
      expect(() => authorize(driver, p)).toThrow(AuthorizationError);
    }
  });

  it('integração nunca executa permissão com step-up', () => {
    const integ: IntegrationActor = {
      type: 'INTEGRATION',
      tokenId: 't',
      name: 'n8n',
      organizationId: 'o',
      permissions: new Set<Permission>(['finance.refund', 'order.create_draft']),
    };
    expect(() => authorize(integ, 'order.create_draft')).not.toThrow();
    expect(() => authorize(integ, 'finance.refund')).toThrow(AuthorizationError);
  });
});
