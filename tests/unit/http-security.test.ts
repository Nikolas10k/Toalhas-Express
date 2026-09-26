import { describe, expect, it } from 'vitest';
import { clientIp, extractBearer, isSameOriginRequest, sanitizeNextPath } from '@/server/http/security';

describe('sanitizeNextPath (open redirect)', () => {
  it.each([
    ['/admin', '/admin'],
    ['/admin/pedidos?x=1#y', '/admin/pedidos?x=1#y'],
    ['//evil.com', '/'],
    ['/\\evil.com', '/'],
    ['https://evil.com', '/'],
    ['javascript:alert(1)', '/'],
    ['/a\u0000b', '/'],
    ['', '/'],
    [undefined, '/'],
  ])('%s -> %s', (input, expected) => {
    expect(sanitizeNextPath(input as string | undefined)).toBe(expected);
  });
});

describe('isSameOriginRequest (CSRF)', () => {
  const app = 'https://app.toalhas.com.br';
  it('aceita mesma origem', () => {
    expect(isSameOriginRequest(new Headers({ origin: app }), app)).toBe(true);
    expect(isSameOriginRequest(new Headers({ 'sec-fetch-site': 'same-origin' }), app)).toBe(true);
  });
  it('rejeita outra origem ou ausência de indicação', () => {
    expect(isSameOriginRequest(new Headers({ origin: 'https://evil.com' }), app)).toBe(false);
    expect(isSameOriginRequest(new Headers({ 'sec-fetch-site': 'cross-site' }), app)).toBe(false);
    expect(isSameOriginRequest(new Headers(), app)).toBe(false);
  });
});

describe('headers', () => {
  it('clientIp usa o primeiro x-forwarded-for', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }))).toBe('1.2.3.4');
    expect(clientIp(new Headers({ 'x-real-ip': '5.6.7.8' }))).toBe('5.6.7.8');
  });
  it('extractBearer', () => {
    expect(extractBearer(new Headers({ authorization: 'Bearer abc.def' }))).toBe('abc.def');
    expect(extractBearer(new Headers({ authorization: 'Basic abc' }))).toBeUndefined();
  });
});
