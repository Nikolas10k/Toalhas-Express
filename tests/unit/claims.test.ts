import { describe, expect, it } from 'vitest';
import { parseSessionClaims } from '@/server/auth/claims';

const sub = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('parseSessionClaims', () => {
  it('extrai aal e o TOTP mais recente', () => {
    const c = parseSessionClaims({
      sub,
      email: 'x@y.com',
      aal: 'aal2',
      amr: [
        { method: 'password', timestamp: 100 },
        { method: 'totp', timestamp: 200 },
        { method: 'totp', timestamp: 150 },
      ],
    });
    expect(c).toEqual({ userId: sub, email: 'x@y.com', sessionId: undefined, aal: 'aal2', lastTotpAt: 200 });
  });

  it('rejeita claims inválidas ou anônimas', () => {
    expect(parseSessionClaims(null)).toBeNull();
    expect(parseSessionClaims({ sub: 'not-a-uuid' })).toBeNull();
    expect(parseSessionClaims({ sub, is_anonymous: true })).toBeNull();
  });

  it('assume aal1 e aceita amr em formato string', () => {
    expect(parseSessionClaims({ sub, amr: ['password'] })).toMatchObject({ aal: 'aal1', lastTotpAt: undefined });
  });
});
