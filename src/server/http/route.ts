import 'server-only';
import { NextResponse } from 'next/server';
import type { ZodType } from 'zod';
import type { AuthenticatedActor, IntegrationActor, UserActor } from '@/server/auth/actor';
import type { SessionClaims } from '@/server/auth/claims';
import { getCurrentUserActor, getSessionClaims } from '@/server/auth/session';
import { assertMfaSatisfied, authorize } from '@/server/authz/authorize';
import type { Permission } from '@/server/authz/permissions';
import { safeEqual } from '@/server/core/crypto';
import { getServerEnv } from '@/server/core/env';
import {
  AuthenticationError,
  AuthorizationError,
  RateLimitError,
  ValidationError,
  isAppError,
  toErrorBody,
} from '@/server/core/errors';
import { logger } from '@/server/core/logger';
import {
  createRequestContext,
  runWithRequestContext,
  sanitizeCorrelationId,
  type RequestContext,
} from '@/server/core/request-context';
import { resolveIntegrationActor } from '@/server/modules/access/access.service';
import { hitRateLimit, RATE_LIMITS } from '@/server/modules/rate-limit/rate-limit.service';
import { clientIp, extractBearer, isSafeMethod, isSameOriginRequest } from './security';
import { zodIssues } from './validation';

export type AuthMode = 'public' | 'session' | 'user' | 'integration' | 'user_or_integration' | 'cron';

type ActorFor<A extends AuthMode> = A extends 'user'
  ? UserActor
  : A extends 'integration'
    ? IntegrationActor
    : A extends 'user_or_integration'
      ? AuthenticatedActor
      : A extends 'cron'
        ? IntegrationActor | { type: 'CRON' }
        : undefined;

export interface HandlerContext<A extends AuthMode, B, Q> {
  req: Request;
  actor: ActorFor<A>;
  /** Presente em auth 'session' (usuário logado, com ou sem vínculo/MFA). */
  claims: A extends 'session' ? SessionClaims : SessionClaims | undefined;
  body: B;
  query: Q;
  params: Record<string, string | string[] | undefined>;
  idempotencyKey: string | undefined;
  ctx: RequestContext;
}

export interface RouteConfig<A extends AuthMode, B, Q> {
  auth: A;
  permission?: Permission;
  body?: ZodType<B>;
  query?: ZodType<Q>;
  /** Default: true para métodos que alteram estado com auth por cookie. */
  csrf?: boolean;
  /** Default: rate limit padrão por ator/token. false desliga (use um específico no handler). */
  rateLimit?: boolean;
  maxBodyBytes?: number;
  requireIdempotencyKey?: boolean;
  handler: (ctx: HandlerContext<A, B, Q>) => Promise<unknown>;
}

type NextRouteContext = { params: Promise<Record<string, string | string[] | undefined>> };

const DEFAULT_MAX_BODY = 64 * 1024;

export function json(data: unknown, init?: number | ResponseInit): NextResponse {
  const responseInit = typeof init === 'number' ? { status: init } : init;
  return NextResponse.json({ data }, responseInit);
}

async function readJsonBody(req: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new ValidationError('Corpo da requisição muito grande.');
  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new ValidationError('Content-Type deve ser application/json.');
  }
  const text = await req.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new ValidationError('Corpo da requisição muito grande.');
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ValidationError('JSON inválido.');
  }
}

async function authenticate(mode: AuthMode, req: Request): Promise<{ actor: unknown; claims?: SessionClaims }> {
  switch (mode) {
    case 'public':
      return { actor: undefined };
    case 'session': {
      const claims = await getSessionClaims();
      if (!claims) throw new AuthenticationError();
      return { actor: undefined, claims };
    }
    case 'user': {
      const actor = await getCurrentUserActor();
      if (!actor) throw new AuthenticationError();
      assertMfaSatisfied(actor);
      return { actor, claims: (await getSessionClaims()) ?? undefined };
    }
    case 'integration':
    case 'user_or_integration':
    case 'cron': {
      const bearer = extractBearer(req.headers);
      if (mode === 'cron' && bearer && safeEqual(bearer, getServerEnv().CRON_SECRET)) {
        return { actor: { type: 'CRON' } };
      }
      if (bearer?.startsWith('txi_')) {
        const actor = await resolveIntegrationActor(bearer);
        if (!actor) throw new AuthenticationError('Token de integração inválido.');
        return { actor };
      }
      if (mode === 'user_or_integration') {
        const actor = await getCurrentUserActor();
        if (!actor) throw new AuthenticationError();
        assertMfaSatisfied(actor);
        return { actor };
      }
      throw new AuthenticationError();
    }
  }
}

/**
 * Wrapper único para Route Handlers: contexto de requisição, CSRF, limite de
 * body, validação Zod estrita, autenticação, autorização por permissão, rate
 * limit e mapeamento de erros sem stack trace.
 */
export function route<A extends AuthMode, B = undefined, Q = undefined>(config: RouteConfig<A, B, Q>) {
  return async (req: Request, routeCtx?: NextRouteContext): Promise<Response> => {
    const ctx = createRequestContext({
      correlationId: sanitizeCorrelationId(req.headers.get('x-correlation-id')),
      ip: clientIp(req.headers),
      userAgent: req.headers.get('user-agent') ?? undefined,
    });

    return runWithRequestContext(ctx, async () => {
      const started = Date.now();
      let status = 500;
      try {
        const method = req.method.toUpperCase();
        const cookieAuth = config.auth === 'public' || config.auth === 'session' || config.auth === 'user';
        const csrf = config.csrf ?? cookieAuth;
        if (csrf && !isSafeMethod(method) && !isSameOriginRequest(req.headers, new URL(getServerEnv().APP_URL).origin)) {
          throw new AuthorizationError('Origem da requisição não permitida.');
        }

        const { actor, claims } = await authenticate(config.auth, req);

        if (config.rateLimit !== false && actor && typeof actor === 'object' && 'type' in actor) {
          const a = actor as AuthenticatedActor | { type: 'CRON' };
          if (a.type === 'INTEGRATION') await hitRateLimit(RATE_LIMITS.integrationByToken, a.tokenId);
          else if (a.type === 'USER')
            await hitRateLimit(isSafeMethod(method) ? RATE_LIMITS.apiReadByActor : RATE_LIMITS.apiWriteByActor, a.userId);
          else if (a.type === 'CRON') await hitRateLimit(RATE_LIMITS.workerByIp, ctx.ip ?? 'unknown');
        }

        if (config.permission) {
          if (!actor || (actor as { type: string }).type === 'CRON') throw new AuthorizationError();
          authorize(actor as AuthenticatedActor, config.permission, {
            stepUpMaxAgeSeconds: getServerEnv().STEP_UP_MAX_AGE_SECONDS,
          });
        }

        let body = undefined as B;
        if (config.body) {
          const raw = await readJsonBody(req, config.maxBodyBytes ?? DEFAULT_MAX_BODY);
          const parsed = config.body.safeParse(raw);
          if (!parsed.success) throw new ValidationError('Dados inválidos.', zodIssues(parsed.error));
          body = parsed.data;
        }

        let query = undefined as Q;
        if (config.query) {
          const params = Object.fromEntries(new URL(req.url).searchParams.entries());
          const parsed = config.query.safeParse(params);
          if (!parsed.success) throw new ValidationError('Parâmetros inválidos.', zodIssues(parsed.error));
          query = parsed.data;
        }

        const idempotencyKey = req.headers.get('idempotency-key') ?? undefined;
        if (config.requireIdempotencyKey && !idempotencyKey) {
          throw new ValidationError('Cabeçalho Idempotency-Key obrigatório.', [
            { path: 'Idempotency-Key', message: 'obrigatório' },
          ]);
        }

        const result = await config.handler({
          req,
          actor: actor as ActorFor<A>,
          claims: claims as HandlerContext<A, B, Q>['claims'],
          body,
          query,
          params: (await routeCtx?.params) ?? {},
          idempotencyKey,
          ctx,
        });
        const response = result instanceof Response ? result : json(result ?? null);
        status = response.status;
        response.headers.set('x-request-id', ctx.requestId);
        return response;
      } catch (err) {
        const { status: errStatus, body } = toErrorBody(err, ctx.requestId);
        status = errStatus;
        if (!isAppError(err)) {
          logger.error('http.unhandled_error', { error: err, stack: err instanceof Error ? err.stack : undefined });
        }
        const response = NextResponse.json(body, { status: errStatus });
        response.headers.set('x-request-id', ctx.requestId);
        if (err instanceof RateLimitError) response.headers.set('Retry-After', String(err.retryAfterSeconds));
        return response;
      } finally {
        logger.info('http.request', {
          method: req.method,
          path: new URL(req.url).pathname,
          status,
          duration_ms: Date.now() - started,
        });
      }
    });
  };
}
