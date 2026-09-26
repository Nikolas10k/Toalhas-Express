import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { getServerEnv } from '@/server/core/env';

/**
 * Cliente com SERVICE ROLE — ignora RLS. Uso restrito a rotinas
 * administrativas no servidor (ex.: convite de usuários). Nunca exportar para
 * componentes client; o check de bundle no CI garante que a chave não vaza.
 */
export function createSupabaseAdminClient() {
  const env = getServerEnv();
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY não configurada.');
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
