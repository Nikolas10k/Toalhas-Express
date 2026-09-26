import { getRequestContext } from './request-context';

type Level = 'debug' | 'info' | 'warn' | 'error';
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Chaves cujo valor nunca pode ir para log. Comparação por substring, case-insensitive. */
const SENSITIVE_KEY_PARTS = [
  'password',
  'senha',
  'secret',
  'token',
  'authorization',
  'cookie',
  'apikey',
  'api_key',
  'access_key',
  'service_role',
  'card',
  'cvv',
  'pan',
  'otp',
  'totp',
  'code_verifier',
  'signature',
];

const REDACTED = '[REDACTED]';

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[-\s]/g, '_');
  return SENSITIVE_KEY_PARTS.some((part) => k.includes(part));
}

// Padrões de segredo em texto livre (JWT, Bearer, chaves Supabase/Asaas).
const SECRET_PATTERNS: RegExp[] = [
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /\bsb_(secret|publishable)_[A-Za-z0-9_-]+/g,
  /\$aact_[A-Za-z0-9_-]+/g,
  /\btxi_[a-z0-9]{8}_[A-Za-z0-9_-]+/g,
];

export function redactString(value: string): string {
  return SECRET_PATTERNS.reduce((acc, re) => acc.replace(re, REDACTED), value);
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[DEPTH_LIMIT]';
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function minLevel(): number {
  const env = (process.env.LOG_LEVEL ?? 'info') as Level;
  return LEVELS[env] ?? LEVELS.info;
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (LEVELS[level] < minLevel()) return;
  const ctx = getRequestContext();
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: redactString(msg),
    request_id: ctx?.requestId,
    correlation_id: ctx?.correlationId,
    ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
  };
  const line = JSON.stringify(entry);
  if (level === 'error' || level === 'warn') console.error(line);
  else process.stdout.write(line + '\n');
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, fields),
};
