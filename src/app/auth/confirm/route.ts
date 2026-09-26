import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { sanitizeNextPath } from '@/server/http/security';
import { createSupabaseServerClient } from '@/server/supabase/server';

const ALLOWED_TYPES: EmailOtpType[] = ['recovery', 'invite', 'signup', 'email', 'email_change'];

/** Destino dos links de e-mail do Supabase (recuperação de senha, convite). */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const next = sanitizeNextPath(url.searchParams.get('next'), '/');

  if (tokenHash && type && ALLOWED_TYPES.includes(type)) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  return NextResponse.redirect(new URL('/login?erro=link_invalido', url.origin));
}
