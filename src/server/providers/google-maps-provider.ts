import 'server-only';
import { ProviderError } from '@/server/core/errors';
import type { GeocodeResult, MapsProvider, OptimizedRoute } from './maps-provider';

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

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

  async optimizeRoute(): Promise<OptimizedRoute> {
    throw new ProviderError(this.name, 'Otimização de rotas será implementada na Fase 5', { retryable: false });
  }
}
