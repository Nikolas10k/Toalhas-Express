/** Dados mínimos e confiáveis extraídos do JWT verificado do Supabase. */
export interface SessionClaims {
  userId: string;
  email?: string;
  sessionId?: string;
  aal: 'aal1' | 'aal2';
  /** Epoch (s) da verificação TOTP mais recente, se houver. */
  lastTotpAt?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseSessionClaims(raw: Record<string, unknown> | null | undefined): SessionClaims | null {
  if (!raw) return null;
  const sub = raw.sub;
  if (typeof sub !== 'string' || !UUID.test(sub)) return null;
  if (raw.role === 'anon' || raw.is_anonymous === true) return null;

  let lastTotpAt: number | undefined;
  if (Array.isArray(raw.amr)) {
    for (const entry of raw.amr as unknown[]) {
      if (entry && typeof entry === 'object') {
        const { method, timestamp } = entry as { method?: unknown; timestamp?: unknown };
        if (method === 'totp' && typeof timestamp === 'number' && Number.isFinite(timestamp)) {
          lastTotpAt = Math.max(lastTotpAt ?? 0, timestamp);
        }
      }
    }
  }

  return {
    userId: sub.toLowerCase(),
    email: typeof raw.email === 'string' ? raw.email : undefined,
    sessionId: typeof raw.session_id === 'string' ? raw.session_id : undefined,
    aal: raw.aal === 'aal2' ? 'aal2' : 'aal1',
    lastTotpAt,
  };
}
