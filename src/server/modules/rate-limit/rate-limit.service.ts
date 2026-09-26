import 'server-only';
import { sha256Hex } from '@/server/core/crypto';
import { RateLimitError } from '@/server/core/errors';
import { logger } from '@/server/core/logger';
import { withSystemTransaction } from '@/server/db/transaction';

export interface RateLimitRule {
  /** Nome da regra, ex.: auth.login:ip */
  name: string;
  max: number;
  windowSeconds: number;
}

/** Regras centralizadas (ajuste aqui, nunca espalhado pelos endpoints). */
export const RATE_LIMITS = {
  loginByIp: { name: 'auth.login:ip', max: 20, windowSeconds: 900 },
  loginByEmail: { name: 'auth.login:email', max: 8, windowSeconds: 900 },
  passwordResetByIp: { name: 'auth.reset:ip', max: 5, windowSeconds: 3600 },
  passwordResetByEmail: { name: 'auth.reset:email', max: 3, windowSeconds: 3600 },
  mfaVerifyByUser: { name: 'auth.mfa:user', max: 6, windowSeconds: 300 },
  mfaEnrollByUser: { name: 'auth.mfa_enroll:user', max: 5, windowSeconds: 3600 },
  apiReadByActor: { name: 'api.read:actor', max: 300, windowSeconds: 60 },
  apiWriteByActor: { name: 'api.write:actor', max: 60, windowSeconds: 60 },
  integrationByToken: { name: 'api.integration:token', max: 120, windowSeconds: 60 },
  workerByIp: { name: 'worker.run:ip', max: 30, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;

function bucketKey(rule: RateLimitRule, identifier: string): string {
  // Identificador (IP, e-mail) nunca é gravado em claro.
  const pepper = process.env.APP_HASH_PEPPER ?? '';
  return `${rule.name}:${sha256Hex(`${pepper}:${identifier.trim().toLowerCase()}`)}`;
}

/** Registra uma tentativa e lança RateLimitError quando o limite estoura. */
export async function hitRateLimit(rule: RateLimitRule, identifier: string): Promise<void> {
  const key = bucketKey(rule, identifier);
  const rows = await withSystemTransaction(
    (tx) => tx<{ allowed: boolean; current_count: number; reset_at: Date }[]>`
      select * from app.rate_limit_hit(${key}, ${rule.windowSeconds}, ${rule.max})
    `,
  );
  const row = rows[0];
  if (row && !row.allowed) {
    const retryAfter = Math.max(1, Math.ceil((row.reset_at.getTime() - Date.now()) / 1000));
    logger.warn('rate_limit.exceeded', { rule: rule.name, count: row.current_count });
    throw new RateLimitError(retryAfter);
  }
}
