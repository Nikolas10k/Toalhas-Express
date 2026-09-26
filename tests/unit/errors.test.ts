import { describe, expect, it } from 'vitest';
import {
  AuthorizationError,
  InventoryError,
  ProviderError,
  RateLimitError,
  ValidationError,
  toErrorBody,
} from '@/server/core/errors';

describe('toErrorBody', () => {
  it('mapeia erros tipados para status e mensagem pública', () => {
    expect(toErrorBody(new AuthorizationError(), 'req-1')).toEqual({
      status: 403,
      body: { error: { code: 'FORBIDDEN', message: 'Você não tem permissão para esta ação.', requestId: 'req-1' } },
    });
    expect(toErrorBody(new InventoryError()).status).toBe(409);
    expect(toErrorBody(new RateLimitError(30)).status).toBe(429);
  });

  it('inclui issues de validação', () => {
    const { status, body } = toErrorBody(new ValidationError('Dados inválidos.', [{ path: 'email', message: 'x' }]));
    expect(status).toBe(422);
    expect(body.error.issues).toEqual([{ path: 'email', message: 'x' }]);
  });

  it('nunca expõe detalhes de erro desconhecido nem stack trace', () => {
    const err = new Error('duplicate key value violates unique constraint "segredo_interno"');
    const { status, body } = toErrorBody(err, 'req-2');
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('segredo_interno');
    expect(JSON.stringify(body)).not.toContain('stack');
  });

  it('ProviderError mostra mensagem genérica e guarda detalhe interno', () => {
    const err = new ProviderError('asaas', 'HTTP 503 upstream');
    expect(err.message).toContain('HTTP 503');
    expect(toErrorBody(err).body.error.message).not.toContain('503');
    expect(err.retryable).toBe(true);
  });
});
