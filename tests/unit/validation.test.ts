import { describe, expect, it } from 'vitest';
import { loginSchema, mfaVerifySchema, updatePasswordSchema } from '@/lib/validation/auth';

describe('schemas de auth', () => {
  it('normaliza e-mail e rejeita campos extras (mass assignment)', () => {
    expect(loginSchema.parse({ email: '  A@B.COM ', password: 'x' })).toEqual({ email: 'a@b.com', password: 'x' });
    expect(loginSchema.safeParse({ email: 'a@b.com', password: 'x', role: 'ADMIN' }).success).toBe(false);
  });

  it('exige senha forte', () => {
    expect(updatePasswordSchema.safeParse({ password: 'curta' }).success).toBe(false);
    expect(updatePasswordSchema.safeParse({ password: 'semnumeroMAIUSC' }).success).toBe(false);
    expect(updatePasswordSchema.safeParse({ password: 'SenhaForte2026' }).success).toBe(true);
  });

  it('código TOTP tem 6 dígitos', () => {
    expect(mfaVerifySchema.safeParse({ code: '123456' }).success).toBe(true);
    expect(mfaVerifySchema.safeParse({ code: '12345a' }).success).toBe(false);
  });
});
