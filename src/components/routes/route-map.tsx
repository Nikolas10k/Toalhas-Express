'use client';

import 'leaflet/dist/leaflet.css';
import type { LayerGroup, Map as LeafletMap } from 'leaflet';
import { useEffect, useRef } from 'react';
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from '@/lib/geo/defaults';

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  label: string;
  title: string;
  /** selected = na rota/selecionado; muted = disponível, não selecionado. */
  tone: 'selected' | 'muted' | 'done';
}

const COLORS = { selected: '#0A9CD0', muted: '#94a3b8', done: '#16a34a' } as const;

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/**
 * Mapa de planejamento: pontos numerados, linha na ordem da rota e a base de
 * saída. Leaflet + OpenStreetMap (sem chave). Clique no ponto chama onToggle.
 */
export function RouteMap({
  points,
  depot,
  drawLine = true,
  onToggle,
  className,
}: {
  points: MapPoint[];
  depot?: { lat: number; lng: number; name: string } | null;
  drawLine?: boolean;
  onToggle?: (id: string) => void;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const fitted = useRef(false);
  const onToggleRef = useRef(onToggle);
  useEffect(() => {
    onToggleRef.current = onToggle;
  }, [onToggle]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = await import('leaflet');
      if (cancelled || !container.current) return;
      if (!map.current) {
        map.current = L.map(container.current, { scrollWheelZoom: false }).setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(map.current);
        layer.current = L.layerGroup().addTo(map.current);
      }
      const group = layer.current!;
      group.clearLayers();
      const bounds: [number, number][] = [];
      if (depot) {
        const icon = L.divIcon({
          className: '',
          html: '<div style="width:26px;height:26px;border-radius:6px;background:#0f172a;color:white;display:grid;place-items:center;font:600 12px sans-serif;border:2px solid white">B</div>',
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        });
        L.marker([depot.lat, depot.lng], { icon, title: `Base: ${depot.name}` }).addTo(group);
        bounds.push([depot.lat, depot.lng]);
      }
      for (const p of points) {
        const icon = L.divIcon({
          className: '',
          html: `<div style="width:26px;height:26px;border-radius:50%;background:${COLORS[p.tone]};color:white;display:grid;place-items:center;font:600 12px sans-serif;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)">${escapeHtml(p.label)}</div>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        });
        const m = L.marker([p.lat, p.lng], { icon, title: p.title, keyboard: true }).addTo(group);
        m.bindTooltip(escapeHtml(p.title));
        m.on('click', () => onToggleRef.current?.(p.id));
        bounds.push([p.lat, p.lng]);
      }
      const line = points.filter((p) => p.tone !== 'muted').map((p) => [p.lat, p.lng] as [number, number]);
      if (drawLine && line.length > 1) {
        const path = depot ? [[depot.lat, depot.lng] as [number, number], ...line, [depot.lat, depot.lng] as [number, number]] : line;
        L.polyline(path, { color: '#0A9CD0', weight: 3, opacity: 0.7, dashArray: '6 6' }).addTo(group);
      }
      if (bounds.length && !fitted.current) {
        map.current.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
        fitted.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [points, depot, drawLine]);

  useEffect(
    () => () => {
      map.current?.remove();
      map.current = null;
      layer.current = null;
    },
    [],
  );

  return (
    <div
      ref={container}
      role="application"
      aria-label="Mapa da rota com as paradas numeradas na ordem de visita"
      className={className ?? 'h-96 w-full overflow-hidden rounded-md border'}
    />
  );
}
