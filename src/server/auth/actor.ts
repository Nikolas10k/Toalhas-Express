import type { Permission } from '@/server/authz/permissions';
import type { DbActorContext } from '@/server/db/transaction';

export interface MfaState {
  /** Nível de garantia da sessão Supabase: aal1 (senha) ou aal2 (senha + TOTP). */
  aal: 'aal1' | 'aal2';
  /** Epoch (s) da última verificação TOTP bem-sucedida nesta sessão. */
  lastTotpAt?: number;
  /** Algum role do membro (ou o próprio vínculo) exige MFA. */
  required: boolean;
}

export interface UserActor {
  type: 'USER';
  userId: string;
  email?: string;
  organizationId: string;
  memberId: string;
  roles: readonly string[];
  permissions: ReadonlySet<Permission>;
  mfa: MfaState;
}

export interface IntegrationActor {
  type: 'INTEGRATION';
  tokenId: string;
  name: string;
  organizationId: string;
  permissions: ReadonlySet<Permission>;
}

export interface SystemActor {
  type: 'SYSTEM';
  reason: string;
}

export type Actor = UserActor | IntegrationActor | SystemActor;
export type AuthenticatedActor = UserActor | IntegrationActor;

export function toDbContext(actor: AuthenticatedActor): DbActorContext {
  return actor.type === 'USER'
    ? { type: 'USER', userId: actor.userId, organizationId: actor.organizationId }
    : { type: 'INTEGRATION', tokenId: actor.tokenId, organizationId: actor.organizationId };
}

export function actorId(actor: Actor): string | null {
  switch (actor.type) {
    case 'USER':
      return actor.userId;
    case 'INTEGRATION':
      return actor.tokenId;
    case 'SYSTEM':
      return null;
  }
}
