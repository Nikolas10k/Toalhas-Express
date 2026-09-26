/** Contrato de mapas/geocoding/rotas (Google — Fases 2 e 5). */
export interface GeocodeResult {
  lat: number;
  lng: number;
  placeId: string;
  formattedAddress: string;
  partialMatch: boolean;
}

export interface RouteStopInput {
  id: string;
  lat: number;
  lng: number;
}

export interface OptimizedRoute {
  orderedStopIds: string[];
  distanceMeters: number;
  durationSeconds: number;
}

export interface MapsProvider {
  readonly name: string;
  geocode(address: string): Promise<GeocodeResult | null>;
  optimizeRoute(origin: RouteStopInput, stops: RouteStopInput[], destination?: RouteStopInput): Promise<OptimizedRoute>;
}
