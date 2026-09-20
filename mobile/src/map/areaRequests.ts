import { levelForZoom, type AreaLevel, type MapArea, type MapAreas, type MapBounds } from './regions.ts';
import { displayGeometry } from './displayGeometry.ts';

export type MapViewport = MapBounds & { lng: number; lat: number; zoom: number };
export type AreaDisplay = { level: AreaLevel | null; features: MapArea[] };

/** One in-flight geometry response and one latest viewport, never a request backlog. */
export function createAreaRequests(
  load: (bounds: MapBounds, level: AreaLevel) => Promise<MapAreas>,
  send: (areas: AreaDisplay) => void,
  delayMs = 350,
) {
  let disposed = false, busy = false, sequence = 0;
  let level: AreaLevel | null = null;
  let pending: { viewport: MapViewport; level: AreaLevel; sequence: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;

  const drain = async () => {
    if (disposed || busy || !pending || !settled) return;
    const request = pending;
    pending = null;
    busy = true;
    try {
      const result = await load(request.viewport, request.level);
      if (!disposed && request.sequence === sequence) send({ level: request.level, features: result.features.map(feature => ({
        ...feature, geometry: displayGeometry(feature.geometry, request.level),
      })) });
    } catch {
      if (!disposed && request.sequence === sequence) send({ level: request.level, features: [] });
    } finally {
      busy = false;
      void drain();
    }
  };

  return {
    schedule(viewport: MapViewport) {
      if (disposed || ![viewport.west, viewport.south, viewport.east, viewport.north, viewport.lng, viewport.lat, viewport.zoom].every(Number.isFinite)
          || viewport.west >= viewport.east || viewport.south >= viewport.north) return;
      const nextLevel = levelForZoom(viewport.zoom);
      sequence++;
      clearTimeout(timer);
      settled = false;
      pending = null;
      if (nextLevel !== level) {
        level = nextLevel;
        send({ level: null, features: [] });
      }
      if (!nextLevel) return;
      pending = { viewport, level: nextLevel, sequence };
      timer = setTimeout(() => { settled = true; void drain(); }, delayMs);
    },
    dispose() {
      disposed = true;
      sequence++;
      pending = null;
      clearTimeout(timer);
    },
  };
}
