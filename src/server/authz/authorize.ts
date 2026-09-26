import type { AuthenticatedActor, UserActor } from '@/server/auth/actor';
import { AuthorizationError, MfaRequiredError, StepUpRequiredError } from '@/server/core/errors';
import { STEP_UP_PERMISSIONS, type Permission } from './permissions';

export const DEFAULT_STEP_UP_MAX_AGE_SECONDS = 600;

export function hasPermission(actor: AuthenticatedActor, permission: Permission): boolean {
  return actor.permissions.has(permission);
}

/** Sessão precisa estar em AAL2 quando algum role do usuário exige MFA. */
export function assertMfaSatisfied(actor: UserActor): void {
  if (actor.mfa.required && actor.mfa.aal !== 'aal2') throw new MfaRequiredError();
}

/** MFA recente: TOTP verificado há no máximo `maxAgeSeconds`. */
export function hasRecentMfa(actor: UserActor, maxAgeSeconds: number, nowSeconds = Date.now() / 1000): boolean {
  if (actor.mfa.aal !== 'aal2' || actor.mfa.lastTotpAt === undefined) return false;
  const age = nowSeconds - actor.mfa.lastTotpAt;
  return age >= -60 && age <= maxAgeSeconds;
}

export interface AuthorizeOptions {
  stepUpMaxAgeSeconds?: number;
  nowSeconds?: number;
}

/**
 * Ponto único de autorização. Valida PERMISSÃO (nunca nome de role), MFA
 * obrigatório e step-up para permissões sensíveis.
 */
export function authorize(actor: AuthenticatedActor, permission: Permission, options: AuthorizeOptions = {}): void {
  if (actor.type === 'USER') assertMfaSatisfied(actor);
  if (!hasPermission(actor, permission)) {
    throw new AuthorizationError(undefined, { permission });
  }
  if (STEP_UP_PERMISSIONS.has(permission)) {
    // Integrações nunca recebem permissões sensíveis (não há humano para step-up).
    if (actor.type !== 'USER') throw new AuthorizationError(undefined, { permission });
    const maxAge = options.stepUpMaxAgeSeconds ?? DEFAULT_STEP_UP_MAX_AGE_SECONDS;
    if (!hasRecentMfa(actor, maxAge, options.nowSeconds)) throw new StepUpRequiredError();
  }
}
