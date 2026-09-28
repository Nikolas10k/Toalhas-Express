export type Geo = { latitude: number; longitude: number; accuracy: number | null } | null;

/** Geolocalização é registrada quando disponível; recusa ou timeout não bloqueiam a operação. */
export function currentPosition(): Promise<Geo> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 30000 },
    );
  });
}
