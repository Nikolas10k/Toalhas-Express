/**
 * Cliente HTTP do navegador. Envia apenas INTENÇÃO; o servidor calcula tudo.
 * Cookies de sessão são httpOnly e enviados automaticamente (same-origin).
 */
export interface ApiIssue {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues: ApiIssue[] = [],
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Gere uma vez por intenção do usuário (ex.: ao abrir o formulário), não por clique. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(path, {
      method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      credentials: 'same-origin',
      signal: options.signal,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Sem conexão com o servidor. Verifique sua internet.');
  }

  const payload = (await res.json().catch(() => null)) as
    | { data?: T; error?: { code: string; message: string; issues?: ApiIssue[]; requestId?: string } }
    | null;

  if (!res.ok) {
    const err = payload?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'UNKNOWN',
      err?.message ?? 'Não foi possível concluir a operação.',
      err?.issues ?? [],
      err?.requestId,
    );
  }
  return payload?.data as T;
}
