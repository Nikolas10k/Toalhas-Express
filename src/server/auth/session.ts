import 'server-only';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { createSupabaseServerClient } from '@/server/supabase/server';
import { resolveUserActor } from '@/server/modules/access/access.service';
import type { UserActor } from './actor';
import { parseSessionClaims, type SessionClaims } from './claims';

export const ACTIVE_ORG_COOKIE = 'tx_org';

/** JWT verificado (assinatura checada pelo Supabase). Memoizado por requisição. */
export const getSessionClaims = cache(async (): Promise<SessionClaims | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;
  return parseSessionClaims(data.claims as Record<string, unknown>);
});

/** Ator do usuário logado com org ativa e permissões efetivas. */
export const getCurrentUserActor = cache(async (): Promise<UserActor | null> => {
  const claims = await getSessionClaims();
  if (!claims) return null;
  const store = await cookies();
  return resolveUserActor(claims, store.get(ACTIVE_ORG_COOKIE)?.value ?? null);
});
