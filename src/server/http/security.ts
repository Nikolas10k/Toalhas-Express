/** Utilitários de segurança HTTP puros (testáveis sem Next). */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}

/**
 * Proteção CSRF para rotas autenticadas por cookie: requisições que alteram
 * estado precisam vir da mesma origem (Origin ou Sec-Fetch-Site). Cookies
 * SameSite=Lax são a primeira barreira; esta é a segunda.
 */
export function isSameOriginRequest(headers: Headers, appOrigin: string): boolean {
  const origin = headers.get('origin');
  if (origin) return origin === appOrigin;
  const site = headers.get('sec-fetch-site');
  if (site) return site === 'same-origin';
  return false;
}

/**
 * Evita open redirect: aceita apenas caminhos relativos internos.
 * Rejeita `//host`, `/\host`, esquemas e caracteres de controle.
 */
export function sanitizeNextPath(value: string | null | undefined, fallback = '/'): string {
  if (!value || typeof value !== 'string' || value.length > 512) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  if (/[\u0000-\u001f\\]/.test(value)) return fallback;
  try {
    const parsed = new URL(value, 'http://internal.invalid');
    if (parsed.origin !== 'http://internal.invalid') return fallback;
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return fallback;
  }
}

/** IP do cliente atrás da Vercel (primeiro valor de x-forwarded-for). */
export function clientIp(headers: Headers): string | undefined {
  const real = headers.get('x-real-ip');
  if (real) return real.trim();
  const fwd = headers.get('x-forwarded-for');
  const first = fwd?.split(',')[0]?.trim();
  return first || undefined;
}

export function extractBearer(headers: Headers): string | undefined {
  const auth = headers.get('authorization');
  if (!auth) return undefined;
  const m = /^Bearer\s+(\S+)$/i.exec(auth.trim());
  return m?.[1];
}
