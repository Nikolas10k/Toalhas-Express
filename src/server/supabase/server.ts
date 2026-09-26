import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Cliente Supabase com a chave PUBLICÁVEL e a sessão do usuário em cookies
 * httpOnly. Usado apenas para Auth (login, MFA, sessão). Dados de negócio são
 * lidos via PostgreSQL com RLS (src/server/db).
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            for (const { name, value, options } of toSet) {
              cookieStore.set(name, value, { ...options, httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' });
            }
          } catch {
            // Server Components não podem gravar cookies; o proxy renova a sessão.
          }
        },
      },
    },
  );
}
