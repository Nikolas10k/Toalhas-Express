import 'server-only';
import { sha256Hex } from '@/server/core/crypto';
import { AuthenticationError, ConflictError, MfaRequiredError, ProviderError, ValidationError } from '@/server/core/errors';
import { getServerEnv } from '@/server/core/env';
import { logger } from '@/server/core/logger';
import { getRequestContext } from '@/server/core/request-context';
import { withSystemTransaction } from '@/server/db/transaction';
import { recordAudit } from '@/server/modules/audit/audit.service';
import { resolveUserActor } from '@/server/modules/access/access.service';
import { hitRateLimit, RATE_LIMITS } from '@/server/modules/rate-limit/rate-limit.service';
import { createSupabaseServerClient } from '@/server/supabase/server';
import { parseSessionClaims, type SessionClaims } from '@/server/auth/claims';
import type { ForgotPasswordInput, LoginInput, MfaVerifyInput, UpdatePasswordInput } from '@/lib/validation/auth';

const GENERIC_LOGIN_ERROR = 'E-mail ou senha inválidos.';

function emailFingerprint(email: string): string {
  return sha256Hex(`${process.env.APP_HASH_PEPPER ?? ''}:email:${email}`).slice(0, 16);
}

/** Próximo passo após login/verificação, sem revelar nada sobre a conta. */
export type AuthNextStep = 'mfa_verify' | 'mfa_enroll' | 'done';

async function auditAuthEvent(
  userId: string | null,
  organizationId: string | null,
  action: string,
  metadata: Record<string, unknown> = {},
) {
  await withSystemTransaction((tx) =>
    recordAudit(
      tx,
      userId ? { type: 'USER', userId } : { type: 'ANONYMOUS' },
      organizationId,
      { action, entityType: 'auth', entityId: userId, metadata },
    ),
  );
}

export async function computeNextStep(claims: SessionClaims): Promise<AuthNextStep> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw new ProviderError('supabase_auth', 'Falha ao consultar nível de autenticação', { cause: error });
  if (data.nextLevel === 'aal2' && data.currentLevel !== 'aal2') return 'mfa_verify';
  if (data.currentLevel === 'aal2') return 'done';
  const actor = await resolveUserActor(claims);
  return actor?.mfa.required ? 'mfa_enroll' : 'done';
}

export async function login(input: LoginInput): Promise<{ next: AuthNextStep }> {
  const ip = getRequestContext()?.ip ?? 'unknown';
  await hitRateLimit(RATE_LIMITS.loginByIp, ip);
  await hitRateLimit(RATE_LIMITS.loginByEmail, input.email);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email: input.email, password: input.password });
  if (error || !data.session) {
    // Mesma resposta para usuário inexistente, senha errada ou conta bloqueada.
    await auditAuthEvent(null, null, 'auth.login_failed', { email_fp: emailFingerprint(input.email) });
    if (error && error.status && error.status >= 500) {
      throw new ProviderError('supabase_auth', `Falha no login: ${error.status}`);
    }
    throw new AuthenticationError(GENERIC_LOGIN_ERROR);
  }

  const { data: claimsData } = await supabase.auth.getClaims(data.session.access_token);
  const claims = parseSessionClaims(claimsData?.claims as Record<string, unknown> | undefined);
  if (!claims) throw new AuthenticationError(GENERIC_LOGIN_ERROR);

  const actor = await resolveUserActor(claims).catch((err) => {
    logger.error('auth.resolve_actor_failed', { error: err });
    return null;
  });
  await auditAuthEvent(claims.userId, actor?.organizationId ?? null, 'auth.login_succeeded');
  return { next: await computeNextStep(claims) };
}

export async function logout(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: 'local' });
}

export async function requestPasswordReset(input: ForgotPasswordInput): Promise<void> {
  const ip = getRequestContext()?.ip ?? 'unknown';
  await hitRateLimit(RATE_LIMITS.passwordResetByIp, ip);
  await hitRateLimit(RATE_LIMITS.passwordResetByEmail, input.email);
  const supabase = await createSupabaseServerClient();
  const redirectTo = new URL('/auth/confirm?next=/redefinir-senha', getServerEnv().APP_URL).toString();
  const { error } = await supabase.auth.resetPasswordForEmail(input.email, { redirectTo });
  // Nunca revelar se o e-mail existe: erros só vão para o log.
  if (error) logger.warn('auth.password_reset_error', { status: error.status, email_fp: emailFingerprint(input.email) });
  await auditAuthEvent(null, null, 'auth.password_reset_requested', { email_fp: emailFingerprint(input.email) });
}

export async function updatePassword(claims: SessionClaims, input: UpdatePasswordInput): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') throw new MfaRequiredError();
  const { error } = await supabase.auth.updateUser({ password: input.password });
  if (error) {
    if (error.status === 422 || error.status === 400) {
      throw new ValidationError('Senha não aceita. Escolha outra senha mais forte.', [
        { path: 'password', message: 'não aceita' },
      ]);
    }
    throw new ProviderError('supabase_auth', `Falha ao atualizar senha: ${error.status}`);
  }
  await auditAuthEvent(claims.userId, null, 'auth.password_changed');
}

export async function enrollTotp(claims: SessionClaims) {
  await hitRateLimit(RATE_LIMITS.mfaEnrollByUser, claims.userId);
  const supabase = await createSupabaseServerClient();
  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) throw new ProviderError('supabase_auth', 'Falha ao listar fatores', { cause: listError });
  if (factors.totp.some((f) => f.status === 'verified')) {
    throw new ConflictError('O autenticador já está configurado para esta conta.');
  }
  // Remove tentativas anteriores não concluídas.
  for (const f of factors.all.filter((f) => f.factor_type === 'totp' && f.status === 'unverified')) {
    await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `Autenticador ${new Date().toISOString().slice(0, 10)}`,
    issuer: 'Toalhas Express',
  });
  if (error || !data) throw new ProviderError('supabase_auth', 'Falha ao iniciar MFA', { cause: error });
  await auditAuthEvent(claims.userId, null, 'auth.mfa_enroll_started');
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

/** Verifica TOTP: conclui cadastro, eleva a sessão a AAL2 ou faz step-up. */
export async function verifyTotp(claims: SessionClaims, input: MfaVerifyInput): Promise<{ next: AuthNextStep }> {
  await hitRateLimit(RATE_LIMITS.mfaVerifyByUser, claims.userId);
  const supabase = await createSupabaseServerClient();
  let factorId = input.factorId;
  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) throw new ProviderError('supabase_auth', 'Falha ao listar fatores', { cause: listError });
  const owned = factors.all.filter((f) => f.factor_type === 'totp');
  if (factorId && !owned.some((f) => f.id === factorId)) throw new AuthenticationError('Fator de autenticação inválido.');
  factorId ??= owned.find((f) => f.status === 'verified')?.id;
  if (!factorId) throw new ConflictError('Configure o autenticador antes de verificar.');

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: input.code });
  if (error) {
    await auditAuthEvent(claims.userId, null, 'auth.mfa_failed');
    throw new AuthenticationError('Código inválido ou expirado.');
  }
  await auditAuthEvent(claims.userId, null, 'auth.mfa_verified');
  return { next: 'done' };
}

export async function getMfaStatus() {
  const supabase = await createSupabaseServerClient();
  const [{ data: factors }, { data: aal }] = await Promise.all([
    supabase.auth.mfa.listFactors(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);
  return {
    enrolled: Boolean(factors?.totp.some((f) => f.status === 'verified')),
    currentLevel: aal?.currentLevel ?? null,
    nextLevel: aal?.nextLevel ?? null,
  };
}
