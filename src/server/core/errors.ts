/**
 * Erros tipados da aplicação. Todo erro esperado é uma subclasse de AppError;
 * qualquer outro erro vira 500 genérico sem detalhes para o cliente.
 */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTHENTICATION_REQUIRED'
  | 'MFA_REQUIRED'
  | 'STEP_UP_REQUIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'BUSINESS_RULE_VIOLATION'
  | 'PROVIDER_ERROR'
  | 'INVENTORY_ERROR'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export interface FieldIssue {
  path: string;
  message: string;
}

export abstract class AppError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly httpStatus: number;
  /** Mensagem segura para exibir ao usuário final. */
  readonly publicMessage: string;
  readonly details?: Record<string, unknown>;

  constructor(publicMessage: string, options?: { details?: Record<string, unknown>; cause?: unknown }) {
    super(publicMessage, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.publicMessage = publicMessage;
    this.details = options?.details;
  }
}

export class ValidationError extends AppError {
  readonly code = 'VALIDATION_ERROR' as const;
  readonly httpStatus = 422;
  readonly issues: FieldIssue[];
  constructor(message = 'Dados inválidos.', issues: FieldIssue[] = []) {
    super(message, { details: { issues } });
    this.issues = issues;
  }
}

export class AuthenticationError extends AppError {
  readonly code = 'AUTHENTICATION_REQUIRED' as const;
  readonly httpStatus = 401;
  constructor(message = 'Autenticação necessária.') {
    super(message);
  }
}

export class MfaRequiredError extends AppError {
  readonly code = 'MFA_REQUIRED' as const;
  readonly httpStatus = 403;
  constructor(message = 'Verificação em duas etapas obrigatória.') {
    super(message);
  }
}

export class StepUpRequiredError extends AppError {
  readonly code = 'STEP_UP_REQUIRED' as const;
  readonly httpStatus = 403;
  constructor(message = 'Confirme sua identidade com o código do autenticador para continuar.') {
    super(message);
  }
}

export class AuthorizationError extends AppError {
  readonly code = 'FORBIDDEN' as const;
  readonly httpStatus = 403;
  constructor(message = 'Você não tem permissão para esta ação.', details?: Record<string, unknown>) {
    super(message, { details });
  }
}

/** Também usado quando o recurso existe mas pertence a outro tenant (evita enumeração). */
export class NotFoundError extends AppError {
  readonly code = 'NOT_FOUND' as const;
  readonly httpStatus = 404;
  constructor(message = 'Registro não encontrado.') {
    super(message);
  }
}

export class ConflictError extends AppError {
  readonly code = 'CONFLICT' as const;
  readonly httpStatus = 409;
  constructor(message = 'Conflito com o estado atual do registro.', details?: Record<string, unknown>) {
    super(message, { details });
  }
}

export class BusinessRuleError extends AppError {
  readonly code = 'BUSINESS_RULE_VIOLATION' as const;
  readonly httpStatus = 422;
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, { details });
  }
}

export class InventoryError extends AppError {
  readonly code = 'INVENTORY_ERROR' as const;
  readonly httpStatus = 409;
  constructor(message = 'Estoque insuficiente.', details?: Record<string, unknown>) {
    super(message, { details });
  }
}

/** Falha em serviço externo. `retryable` orienta o job a tentar de novo. */
export class ProviderError extends AppError {
  readonly code = 'PROVIDER_ERROR' as const;
  readonly httpStatus = 502;
  readonly provider: string;
  readonly retryable: boolean;
  constructor(provider: string, message: string, options?: { retryable?: boolean; cause?: unknown }) {
    super('Serviço externo indisponível no momento. A operação será retomada automaticamente.', {
      cause: options?.cause,
      details: { provider },
    });
    this.provider = provider;
    this.retryable = options?.retryable ?? true;
    this.message = `[${provider}] ${message}`;
  }
}

export class RateLimitError extends AppError {
  readonly code = 'RATE_LIMITED' as const;
  readonly httpStatus = 429;
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number, message = 'Muitas tentativas. Aguarde um pouco e tente novamente.') {
    super(message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    requestId?: string;
    issues?: FieldIssue[];
  };
}

/** Converte qualquer erro em corpo seguro para o cliente (sem stack trace). */
export function toErrorBody(err: unknown, requestId?: string): { status: number; body: ErrorBody } {
  if (isAppError(err)) {
    return {
      status: err.httpStatus,
      body: {
        error: {
          code: err.code,
          message: err.publicMessage,
          requestId,
          ...(err instanceof ValidationError && err.issues.length > 0 ? { issues: err.issues } : {}),
        },
      },
    };
  }
  return {
    status: 500,
    body: { error: { code: 'INTERNAL_ERROR', message: 'Erro interno. Tente novamente em instantes.', requestId } },
  };
}
