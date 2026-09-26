import 'server-only';
import { GEOCODE_BOUNDS_BIAS } from '@/lib/geo/defaults';
import { ProviderError } from '@/server/core/errors';
import type { GeocodeResult, MapsProvider, OptimizedRoute, RouteStopInput } from './maps-provider';

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
/** Limite de paradas intermediárias com otimização na Routes API. */
export const MAX_OPTIMIZED_STOPS = 25;

interface GoogleRoutesResponse {
  routes?: Array<{ distanceMeters?: number; duration?: string; optimizedIntermediateWaypointIndex?: number[] }>;
  error?: { status?: string; message?: string };
}

const waypoint = (p: RouteStopInput) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });

interface GoogleGeocodeResponse {
  status: string;
  error_message?: string;
  results?: Array<{
    place_id: string;
    formatted_address: string;
    partial_match?: boolean;
    geometry: { location: { lat: number; lng: number }; location_type?: string };
  }>;
}

/**
 * Google Geocoding API (chave de SERVIDOR, restrita por API). O parser ignora
 * campos desconhecidos. Erros transitórios → ProviderError repetível; chave
 * inválida/negada → não repetível (vai para dead letter e aparece no alerta).
 */
export class GoogleMapsProvider implements MapsProvider {
  readonly name = 'google_maps';

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 8_000,
  ) {}

  async geocode(address: string): Promise<GeocodeResult | null> {
    const url = new URL(GEOCODE_URL);
    url.searchParams.set('address', address);
    url.searchParams.set('region', 'br');
    url.searchParams.set('language', 'pt-BR');
    url.searchParams.set('components', 'country:BR');
    url.searchParams.set('bounds', GEOCODE_BOUNDS_BIAS);
    url.searchParams.set('key', this.apiKey);

    let res: Response;
    try {
      res = await this.fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (err) {
      throw new ProviderError(this.name, 'Falha de rede no geocoding', { cause: err });
    }
    if (!res.ok) throw new ProviderError(this.name, `HTTP ${res.status} no geocoding`, { retryable: res.status >= 500 || res.status === 429 });

    const body = (await res.json()) as GoogleGeocodeResponse;
    switch (body.status) {
      case 'OK': {
        const r = body.results?.[0];
        if (!r) return null;
        return {
          lat: r.geometry.location.lat,
          lng: r.geometry.location.lng,
          placeId: r.place_id,
          formattedAddress: r.formatted_address,
          // APPROXIMATE (centro de cidade/bairro) também conta como parcial.
          partialMatch: Boolean(r.partial_match) || r.geometry.location_type === 'APPROXIMATE',
        };
      }
      case 'ZERO_RESULTS':
        return null;
      case 'OVER_QUERY_LIMIT':
      case 'UNKNOWN_ERROR':
        throw new ProviderError(this.name, `Geocoding: ${body.status}`);
      default:
        // REQUEST_DENIED / INVALID_REQUEST: configuração ou dado inválido — não adianta repetir.
        throw new ProviderError(this.name, `Geocoding: ${body.status}`, { retryable: false });
    }
  }

  /**
   * Google Routes API (computeRoutes com optimizeWaypointOrder). Origem e
   * destino fixos; as paradas intermediárias são reordenadas. Sem trânsito em
   * tempo real (a otimização de ordem não aceita TRAFFIC_AWARE_OPTIMAL).
   */
  async optimizeRoute(origin: RouteStopInput, stops: RouteStopInput[], destination: RouteStopInput = origin): Promise<OptimizedRoute> {
    if (stops.length === 0) return { orderedStopIds: [], distanceMeters: 0, durationSeconds: 0 };
    if (stops.length > MAX_OPTIMIZED_STOPS) {
      throw new ProviderError(this.name, `Otimização aceita até ${MAX_OPTIMIZED_STOPS} paradas`, { retryable: false });
    }
    let res: Response;
    try {
      res = await this.fetchImpl(ROUTES_URL, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs * 2),
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.apiKey,
          'x-goog-fieldmask': 'routes.distanceMeters,routes.duration,routes.optimizedIntermediateWaypointIndex',
        },
        body: JSON.stringify({
          origin: waypoint(origin),
          destination: waypoint(destination),
          intermediates: stops.map(waypoint),
          travelMode: 'DRIVE',
          routingPreference: 'TRAFFIC_UNAWARE',
          optimizeWaypointOrder: stops.length > 1,
          languageCode: 'pt-BR',
          regionCode: 'BR',
          units: 'METRIC',
        }),
      });
    } catch (err) {
      throw new ProviderError(this.name, 'Falha de rede na otimização de rota', { cause: err });
    }
    const body = (await res.json().catch(() => ({}))) as GoogleRoutesResponse;
    if (!res.ok) {
      throw new ProviderError(this.name, `Routes API: HTTP ${res.status} ${body.error?.status ?? ''}`.trim(), {
        retryable: res.status >= 500 || res.status === 429,
      });
    }
    const route = body.routes?.[0];
    if (!route) throw new ProviderError(this.name, 'Routes API não encontrou caminho entre as paradas', { retryable: false });
    const order = stops.length > 1 ? route.optimizedIntermediateWaypointIndex ?? [] : [0];
    // A resposta tem de ser uma permutação completa; caso contrário, não confiamos nela.
    if (order.length !== stops.length || new Set(order).size !== stops.length || order.some((i) => i < 0 || i >= stops.length)) {
      throw new ProviderError(this.name, 'Routes API devolveu ordem inválida', { retryable: false });
    }
    return {
      orderedStopIds: order.map((i) => stops[i]!.id),
      distanceMeters: Math.max(0, Math.round(route.distanceMeters ?? 0)),
      durationSeconds: Math.max(0, Math.round(Number.parseFloat(route.duration ?? '0') || 0)),
    };
  }
}
