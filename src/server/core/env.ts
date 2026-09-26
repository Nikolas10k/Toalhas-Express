import 'server-only';
import { z } from 'zod';

/**
 * Variáveis de ambiente do SERVIDOR. Validadas na primeira leitura; nunca
 * importar este módulo em componentes client. Variáveis de integração são
 * opcionais: sem credencial, o adapter fica desabilitado e os eventos ficam
 * pendentes (nunca inventamos credenciais).
 */
const optionalSecret = z
  .string()
  .trim()
  .transform((v) => (v === '' ? undefined : v))
  .optional();

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  APP_URL: z.url(),
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: optionalSecret,
  /** Segredo usado pela Vercel Cron (Authorization: Bearer) para acionar o worker. */
  CRON_SECRET: z.string().min(32),
  /** Pepper para hashes de rate limit e tokens (não reversível). */
  APP_HASH_PEPPER: z.string().min(32),
  STEP_UP_MAX_AGE_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
  N8N_OUTBOX_WEBHOOK_URL: z.url().optional().or(z.literal('').transform(() => undefined)),
  N8N_OUTBOX_HMAC_SECRET: optionalSecret,
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Lista apenas os NOMES das variáveis inválidas, nunca os valores.
    const names = [...new Set(parsed.error.issues.map((i) => i.path.join('.')))].join(', ');
    throw new Error(`Variáveis de ambiente inválidas ou ausentes: ${names}`);
  }
  if (parsed.data.APP_ENV === 'production' && !parsed.data.APP_URL.startsWith('https://')) {
    throw new Error('APP_URL deve usar https em produção.');
  }
  cached = parsed.data;
  return cached;
}

/** Apenas para testes. */
export function resetServerEnvCache(): void {
  cached = undefined;
}
