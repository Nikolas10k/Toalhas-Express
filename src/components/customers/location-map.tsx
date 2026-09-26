'use client';

import 'leaflet/dist/leaflet.css';
import type { Map as LeafletMap, Marker } from 'leaflet';
import { useEffect, useRef } from 'react';

const DEFAULT_CENTER: [number, number] = [-23.5505, -46.6333]; // São Paulo

/**
 * Mapa com marcador (Leaflet + OpenStreetMap, sem chave de API). Em modo
 * edição o marcador pode ser arrastado ou reposicionado com um clique.
 */
export function LocationMap({
  latitude,
  longitude,
  editable = false,
  onChange,
  className,
}: {
  latitude: number | null;
  longitude: number | null;
  editable?: boolean;
  onChange?: (lat: number, lng: number) => void;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = await import('leaflet');
      if (cancelled || !container.current || map.current) return;
      const hasPoint = latitude !== null && longitude !== null;
      const center: [number, number] = hasPoint ? [latitude!, longitude!] : DEFAULT_CENTER;
      map.current = L.map(container.current, { scrollWheelZoom: false }).setView(center, hasPoint ? 17 : 11);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map.current);
      const icon = L.divIcon({
        className: '',
        html: '<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;background:#0A9CD0;border:3px solid white;transform:rotate(-45deg);box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
        iconSize: [22, 22],
        iconAnchor: [11, 22],
      });
      if (hasPoint || editable) {
        marker.current = L.marker(center, { draggable: editable, icon, keyboard: true, title: 'Localização do cliente' }).addTo(map.current);
        marker.current.on('dragend', () => {
          const p = marker.current!.getLatLng();
          onChangeRef.current?.(p.lat, p.lng);
        });
      }
      if (editable) {
        map.current.on('click', (e) => {
          marker.current?.setLatLng(e.latlng);
          onChangeRef.current?.(e.latlng.lat, e.latlng.lng);
        });
      }
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      marker.current = null;
    };
    // O mapa é recriado ao alternar o modo de edição.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable]);

  useEffect(() => {
    if (latitude === null || longitude === null || !map.current || !marker.current) return;
    marker.current.setLatLng([latitude, longitude]);
  }, [latitude, longitude]);

  return (
    <div
      ref={container}
      role="application"
      aria-label={editable ? 'Mapa: arraste o marcador ou clique para ajustar a localização' : 'Mapa com a localização do cliente'}
      className={className ?? 'h-72 w-full overflow-hidden rounded-md border'}
    />
  );
}
