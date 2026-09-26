import { describe, expect, it, vi } from 'vitest';
import { ProviderError } from '@/server/core/errors';
import { GoogleMapsProvider } from '@/server/providers/google-maps-provider';

const origin = { id: 'depot', lat: -23.5, lng: -46.6 };
const stops = [
  { id: 'a', lat: -23.51, lng: -46.61 },
  { id: 'b', lat: -23.52, lng: -46.62 },
  { id: 'c', lat: -23.53, lng: -46.63 },
];

function provider(status: number, body: unknown) {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  return { p: new GoogleMapsProvider('server-key', fetchImpl as unknown as typeof fetch), fetchImpl };
}

describe('Google Routes API', () => {
  it('envia chave no header (não na URL), pede só os campos necessários e aplica a ordem otimizada', async () => {
    const { p, fetchImpl } = provider(200, { routes: [{ distanceMeters: 15234, duration: '1834s', optimizedIntermediateWaypointIndex: [2, 0, 1] }] });
    const r = await p.optimizeRoute(origin, stops);
    expect(r).toEqual({ orderedStopIds: ['c', 'a', 'b'], distanceMeters: 15234, durationSeconds: 1834 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain('key=');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe('server-key');
    expect(headers['x-goog-fieldmask']).toContain('optimizedIntermediateWaypointIndex');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ optimizeWaypointOrder: true, travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE' });
    expect(body.intermediates).toHaveLength(3);
  });

  it('ordem inválida da API nunca é aceita', async () => {
    const { p } = provider(200, { routes: [{ distanceMeters: 1, duration: '1s', optimizedIntermediateWaypointIndex: [0, 0, 1] }] });
    await expect(p.optimizeRoute(origin, stops)).rejects.toBeInstanceOf(ProviderError);
  });

  it('erro 403 não é repetível; 503 é', async () => {
    const denied = provider(403, { error: { status: 'PERMISSION_DENIED' } });
    await expect(denied.p.optimizeRoute(origin, stops)).rejects.toMatchObject({ retryable: false });
    const down = provider(503, {});
    await expect(down.p.optimizeRoute(origin, stops)).rejects.toMatchObject({ retryable: true });
  });

  it('acima de 25 paradas recusa sem chamar a API', async () => {
    const { p, fetchImpl } = provider(200, {});
    const many = Array.from({ length: 26 }, (_, i) => ({ id: String(i), lat: -23.5, lng: -46.6 }));
    await expect(p.optimizeRoute(origin, many)).rejects.toBeInstanceOf(ProviderError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
