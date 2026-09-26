import { BusinessRuleError } from '@/server/core/errors';
import { defineStateMachine } from '@/server/core/state-machine';

export const ROUTE_STATUSES = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type RouteStatus = (typeof ROUTE_STATUSES)[number];

export const STOP_STATUSES = ['PENDING', 'ON_THE_WAY', 'ARRIVED', 'IN_SERVICE', 'COMPLETED', 'FAILED', 'SKIPPED', 'RESCHEDULED'] as const;
export type StopStatus = (typeof STOP_STATUSES)[number];

/** SPEC §7: PLANNED → IN_PROGRESS → COMPLETED | CANCELLED. */
export const routeStateMachine = defineStateMachine<RouteStatus>('route', {
  PLANNED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
});

/**
 * Paradas. A caminho pode voltar a PENDING quando o motorista escolhe outra
 * parada como próxima. Conclusão, falha, pulo e reagendamento são registrados
 * pelos fluxos de entrega/coleta e ocorrências (Fase 6).
 */
export const stopStateMachine = defineStateMachine<StopStatus>('route_stop', {
  PENDING: ['ON_THE_WAY', 'SKIPPED', 'RESCHEDULED'],
  ON_THE_WAY: ['ARRIVED', 'PENDING', 'FAILED'],
  ARRIVED: ['IN_SERVICE', 'FAILED'],
  IN_SERVICE: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: [],
  SKIPPED: [],
  RESCHEDULED: [],
});

export const OPEN_STOP_STATUSES: ReadonlySet<StopStatus> = new Set(['PENDING', 'ON_THE_WAY', 'ARRIVED', 'IN_SERVICE']);

/** Transições de parada que o motorista faz pelo app nesta fase. */
export const DRIVER_STOP_TRANSITIONS: ReadonlySet<StopStatus> = new Set(['ON_THE_WAY', 'ARRIVED']);

/** Rota só termina quando nenhuma parada ficou aberta. */
export function assertCanFinish(stops: { status: StopStatus }[]): void {
  const open = stops.filter((s) => OPEN_STOP_STATUSES.has(s.status)).length;
  if (open > 0) throw new BusinessRuleError(`Ainda há ${open} parada(s) em aberto. Conclua ou registre o problema de cada uma antes de finalizar.`);
}

/** Capacidade: toalhas a entregar não podem exceder a do veículo. */
export function assertCapacity(capacity: number, deliveryTotal: number): void {
  if (deliveryTotal > capacity) {
    throw new BusinessRuleError(`A rota leva ${deliveryTotal} toalhas e o veículo comporta ${capacity}. Use outro veículo ou divida a rota.`, {
      capacity,
      delivery_total: deliveryTotal,
    });
  }
}

/** Nova ordem precisa ser uma permutação exata das paradas atuais. */
export function assertPermutation(current: string[], next: string[]): void {
  const a = [...current].sort();
  const b = [...next].sort();
  if (a.length !== b.length || a.some((v, i) => v !== b[i])) {
    throw new BusinessRuleError('A nova ordem deve conter exatamente as paradas da rota.');
  }
}

export interface LatLng {
  lat: number;
  lng: number;
}

/** Distância em linha reta (metros) — usada só como referência quando não há otimização. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export function straightLineTotal(points: (LatLng | null)[]): number | null {
  const valid = points.filter((p): p is LatLng => p !== null);
  if (valid.length < 2 || valid.length !== points.length) return null;
  let total = 0;
  for (let i = 1; i < valid.length; i += 1) total += haversineMeters(valid[i - 1]!, valid[i]!);
  return total;
}

/** Link de navegação (abre o app do Google Maps no celular; sem chave de API). */
export function navigationUrl(point: LatLng | null, address: string): string {
  const destination = point ? `${point.lat},${point.lng}` : address;
  return `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent(destination)}`;
}
