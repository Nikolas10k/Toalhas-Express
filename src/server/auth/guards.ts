import 'server-only';
import { redirect } from 'next/navigation';
import type { Permission } from '@/server/authz/permissions';
import { getMfaStatus } from '@/server/modules/auth/auth.service';
import type { UserActor } from './actor';
import { getCurrentUserActor, getSessionClaims } from './session';

/**
 * Guarda de páginas (Server Components). Redireciona em vez de lançar erro.
 * Não substitui a autorização dos services — cada service valida de novo.
 */
export async function requirePageActor(permission: Permission, currentPath: string): Promise<UserActor> {
  const claims = await getSessionClaims();
  if (!claims) redirect(`/login?next=${encodeURIComponent(currentPath)}`);

  const actor = await getCurrentUserActor();
  if (!actor) redirect('/sem-acesso');

  if (actor.mfa.aal !== 'aal2') {
    const status = await getMfaStatus();
    const mustVerify = status.nextLevel === 'aal2' || actor.mfa.required;
    if (mustVerify) redirect(`/mfa?next=${encodeURIComponent(currentPath)}`);
  }

  if (!actor.permissions.has(permission)) redirect('/sem-acesso');
  return actor;
}

/** Destino inicial conforme permissões (nunca pelo nome do role). */
export function homePathFor(actor: UserActor): string {
  if (actor.permissions.has('admin.access')) return '/admin';
  if (actor.permissions.has('driver_app.access')) return '/motorista';
  if (actor.permissions.has('portal.access')) return '/portal';
  return '/sem-acesso';
}
