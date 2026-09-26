import { describe, expect, it } from 'vitest';
import { redact, redactString } from '@/server/core/logger';

describe('redação de logs', () => {
  it('mascara chaves sensíveis em qualquer profundidade', () => {
    const out = redact({
      email: 'a@b.com',
      password: 'x',
      nested: { apiKey: 'k', Authorization: 'Bearer abc', card_number: '4111', ok: 1 },
      list: [{ access_token: 't' }],
    }) as Record<string, unknown>;
    expect(out.password).toBe('[REDACTED]');
    expect(out.email).toBe('a@b.com');
    expect(out.nested).toEqual({ apiKey: '[REDACTED]', Authorization: '[REDACTED]', card_number: '[REDACTED]', ok: 1 });
    expect(out.list).toEqual([{ access_token: '[REDACTED]' }]);
  });

  it('mascara segredos em texto livre', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    expect(redactString(`token ${jwt} fim`)).toBe('token [REDACTED] fim');
    expect(redactString('Authorization: Bearer abc.def')).not.toContain('abc.def');
    expect(redactString('key $aact_prod_123abc')).not.toContain('aact_prod');
    expect(redactString('sb_secret_abcdef123')).toBe('[REDACTED]');
  });
});
